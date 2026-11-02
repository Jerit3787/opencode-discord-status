package discord

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"testing"
	"time"
)

// mockConn implements the Conn interface for testing
type mockConn struct {
	writeBuffer bytes.Buffer
	readBuffer  bytes.Buffer
	readErr     error
	writeErr    error
	closed      bool
}

func (m *mockConn) Read(b []byte) (n int, err error) {
	if m.readErr != nil {
		return 0, m.readErr
	}
	return m.readBuffer.Read(b)
}

func (m *mockConn) Write(b []byte) (n int, err error) {
	if m.writeErr != nil {
		return 0, m.writeErr
	}
	return m.writeBuffer.Write(b)
}

func (m *mockConn) Close() error {
	m.closed = true
	return nil
}

// writeFrame writes a Discord IPC frame to the mock connection's read buffer
func (m *mockConn) writeFrame(opcode int32, payload []byte) {
	binary.Write(&m.readBuffer, binary.LittleEndian, opcode)
	binary.Write(&m.readBuffer, binary.LittleEndian, int32(len(payload)))
	m.readBuffer.Write(payload)
}

func TestNewClient(t *testing.T) {
	clientID := "123456789"
	client := NewClient(clientID)

	if client == nil {
		t.Fatal("NewClient returned nil")
	}
	if client.clientID != clientID {
		t.Errorf("clientID = %q, want %q", client.clientID, clientID)
	}
	if client.conn != nil {
		t.Error("conn should be nil before Connect()")
	}
}

func TestClient_Close(t *testing.T) {
	t.Run("Close with nil connection", func(t *testing.T) {
		client := NewClient("test")
		err := client.Close()
		if err != nil {
			t.Errorf("Close() with nil conn returned error: %v", err)
		}
	})

	t.Run("Close with active connection", func(t *testing.T) {
		client := NewClient("test")
		mockConn := &mockConn{}
		client.conn = mockConn

		err := client.Close()
		if err != nil {
			t.Errorf("Close() returned error: %v", err)
		}
		if !mockConn.closed {
			t.Error("Connection was not closed")
		}
	})
}

func TestClient_SetActivity_NotConnected(t *testing.T) {
	client := NewClient("test")
	err := client.SetActivity(Activity{Details: "Test"})
	if err == nil {
		t.Error("SetActivity without connection should return error")
	}
	if err.Error() != "not connected" {
		t.Errorf("Error = %q, want %q", err.Error(), "not connected")
	}
}

func TestClient_send(t *testing.T) {
	tests := []struct {
		name    string
		opcode  int
		data    interface{}
		wantErr bool
	}{
		{
			name:   "Handshake opcode",
			opcode: opHandshake,
			data:   map[string]interface{}{"v": 1, "client_id": "test"},
		},
		{
			name:   "Frame opcode",
			opcode: opFrame,
			data:   map[string]interface{}{"cmd": "TEST"},
		},
		{
			name:   "Empty payload",
			opcode: opFrame,
			data:   map[string]interface{}{},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			client := NewClient("test")
			mock := &mockConn{}
			client.conn = mock

			err := client.send(tt.opcode, tt.data)
			if (err != nil) != tt.wantErr {
				t.Errorf("send() error = %v, wantErr %v", err, tt.wantErr)
				return
			}

			if tt.wantErr {
				return
			}

			// Verify frame format
			frame := mock.writeBuffer.Bytes()
			if len(frame) < 8 {
				t.Fatalf("Frame too short: %d bytes", len(frame))
			}

			gotOpcode := binary.LittleEndian.Uint32(frame[0:4])
			if int(gotOpcode) != tt.opcode {
				t.Errorf("opcode = %d, want %d", gotOpcode, tt.opcode)
			}

			length := binary.LittleEndian.Uint32(frame[4:8])
			if int(length)+8 != len(frame) {
				t.Errorf("length header %d doesn't match actual payload length %d", length, len(frame)-8)
			}

			// Verify payload is valid JSON
			var parsed interface{}
			if err := json.Unmarshal(frame[8:], &parsed); err != nil {
				t.Errorf("Payload is not valid JSON: %v", err)
			}
		})
	}

	t.Run("Write error", func(t *testing.T) {
		client := NewClient("test")
		mock := &mockConn{writeErr: errors.New("write failed")}
		client.conn = mock

		err := client.send(opFrame, map[string]string{"test": "data"})
		if err == nil {
			t.Error("Expected error when write fails")
		}
	})
}

func TestClient_receive(t *testing.T) {
	t.Run("Valid frame", func(t *testing.T) {
		client := NewClient("test")
		mock := &mockConn{}
		client.conn = mock

		// Write a valid frame to the read buffer
		payload := []byte(`{"type":"READY"}`)
		mock.writeFrame(opFrame, payload)

		received, err := client.receive()
		if err != nil {
			t.Fatalf("receive() error: %v", err)
		}

		if !bytes.Equal(received, payload) {
			t.Errorf("received = %s, want %s", received, payload)
		}
	})

	t.Run("Empty payload", func(t *testing.T) {
		client := NewClient("test")
		mock := &mockConn{}
		client.conn = mock

		mock.writeFrame(opFrame, []byte{})

		received, err := client.receive()
		if err != nil {
			t.Fatalf("receive() error: %v", err)
		}

		if len(received) != 0 {
			t.Errorf("received length = %d, want 0", len(received))
		}
	})

	t.Run("Read error on header", func(t *testing.T) {
		client := NewClient("test")
		mock := &mockConn{readErr: io.EOF}
		client.conn = mock

		_, err := client.receive()
		if err == nil {
			t.Error("Expected error on read failure")
		}
	})

	t.Run("Read error on payload", func(t *testing.T) {
		client := NewClient("test")
		mock := &mockConn{}
		client.conn = mock

		// Write header only, no payload
		binary.Write(&mock.readBuffer, binary.LittleEndian, int32(opFrame))
		binary.Write(&mock.readBuffer, binary.LittleEndian, int32(100)) // Claims 100 bytes

		_, err := client.receive()
		if err == nil {
			t.Error("Expected error when payload read fails")
		}
	})
}

func TestFrameFormat(t *testing.T) {
	// This test verifies the Discord IPC frame format is correct
	// Frame format: [opcode:4 LE][length:4 LE][JSON payload]

	client := NewClient("1234567890")
	mock := &mockConn{}
	client.conn = mock

	testData := map[string]interface{}{
		"cmd":   "SET_ACTIVITY",
		"nonce": "test-nonce",
		"args": map[string]interface{}{
			"pid":      12345,
			"activity": map[string]interface{}{},
		},
	}

	client.send(opFrame, testData)

	frame := mock.writeBuffer.Bytes()

	// First 4 bytes: opcode (little endian)
	if binary.LittleEndian.Uint32(frame[0:4]) != 1 {
		t.Error("Opcode should be 1 for Frame")
	}

	// Next 4 bytes: payload length (little endian)
	payloadLen := binary.LittleEndian.Uint32(frame[4:8])

	// Remaining bytes should match the length
	actualPayload := frame[8:]
	if len(actualPayload) != int(payloadLen) {
		t.Errorf("Payload length mismatch: header says %d, actual is %d", payloadLen, len(actualPayload))
	}

	// Verify it's valid JSON
	var parsed map[string]interface{}
	if err := json.Unmarshal(actualPayload, &parsed); err != nil {
		t.Errorf("Payload is not valid JSON: %v", err)
	}

	// Verify the structure
	if parsed["cmd"] != "SET_ACTIVITY" {
		t.Errorf("cmd = %v, want SET_ACTIVITY", parsed["cmd"])
	}
}

// Helper function to create time pointer
func timePtr(t time.Time) *time.Time {
	return &t
}

func TestActivityData(t *testing.T) {
	start := time.Date(2025, 1, 1, 12, 0, 0, 0, time.UTC)

	t.Run("minimal", func(t *testing.T) {
		data := activityData(Activity{Details: "Working"})
		if data["details"] != "Working" {
			t.Errorf("details = %v", data["details"])
		}
		if _, ok := data["state"]; ok {
			t.Error("state should be omitted")
		}
		if _, ok := data["timestamps"]; ok {
			t.Error("timestamps should be omitted")
		}
	})

	t.Run("full", func(t *testing.T) {
		data := activityData(Activity{
			Details:    "Working",
			State:      "In progress",
			LargeImage: "logo",
			LargeText:  "App",
			SmallImage: "model",
			SmallText:  "Claude",
			StartTime:  &start,
		})

		if data["state"] != "In progress" {
			t.Errorf("state = %v", data["state"])
		}

		timestamps, ok := data["timestamps"].(map[string]int64)
		if !ok || timestamps["start"] != start.Unix() {
			t.Errorf("timestamps = %#v", data["timestamps"])
		}

		assets, ok := data["assets"].(map[string]string)
		if !ok {
			t.Fatalf("assets = %#v", data["assets"])
		}
		if assets["large_image"] != "logo" || assets["small_text"] != "Claude" {
			t.Errorf("assets = %#v", assets)
		}
	})
}
