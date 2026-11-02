package discord

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"io"
	"strings"
	"testing"
)

type chunkedConn struct {
	data   []byte
	pos    int
	max    int
	writes bytes.Buffer
}

func (c *chunkedConn) Read(p []byte) (int, error) {
	if c.pos >= len(c.data) {
		return 0, io.EOF
	}
	limit := len(p)
	if c.max > 0 && limit > c.max {
		limit = c.max
	}
	if remaining := len(c.data) - c.pos; limit > remaining {
		limit = remaining
	}
	copy(p, c.data[c.pos:c.pos+limit])
	c.pos += limit
	return limit, nil
}

func (c *chunkedConn) Write(p []byte) (int, error) { return c.writes.Write(p) }
func (c *chunkedConn) Close() error                { return nil }

func encode(opcode int, data interface{}) []byte {
	payload, err := json.Marshal(data)
	if err != nil {
		panic(err)
	}
	buf := new(bytes.Buffer)
	_ = binary.Write(buf, binary.LittleEndian, int32(opcode))
	_ = binary.Write(buf, binary.LittleEndian, int32(len(payload)))
	buf.Write(payload)
	return buf.Bytes()
}

func TestReadFrameHandlesFragmentation(t *testing.T) {
	conn := &chunkedConn{
		data: encode(opFrame, map[string]string{"hello": "world"}),
		max:  1,
	}

	opcode, payload, err := readFrame(conn)
	if err != nil {
		t.Fatal(err)
	}
	if opcode != opFrame {
		t.Fatalf("opcode = %d", opcode)
	}

	var got map[string]string
	if err := json.Unmarshal(payload, &got); err != nil {
		t.Fatal(err)
	}
	if got["hello"] != "world" {
		t.Fatalf("payload = %s", payload)
	}
}

func TestValidateHandshakeReady(t *testing.T) {
	conn := &chunkedConn{
		data: encode(opFrame, map[string]interface{}{"cmd": "DISPATCH", "evt": "READY"}),
	}
	if err := validateHandshake(conn); err != nil {
		t.Fatalf("validateHandshake() = %v", err)
	}
}

func TestValidateHandshakeRejectsClose(t *testing.T) {
	conn := &chunkedConn{
		data: encode(opClose, map[string]interface{}{"code": 4000, "message": "Invalid Client ID"}),
	}

	err := validateHandshake(conn)
	if err == nil || !strings.Contains(err.Error(), "4000") {
		t.Fatalf("expected a close error, got %v", err)
	}
}

func TestValidateHandshakeRejectsError(t *testing.T) {
	conn := &chunkedConn{
		data: encode(opFrame, map[string]interface{}{
			"cmd": "DISPATCH",
			"evt": "ERROR",
			"data": map[string]interface{}{
				"code":    4000,
				"message": "Invalid Client ID",
			},
		}),
	}

	err := validateHandshake(conn)
	if err == nil || !strings.Contains(err.Error(), "Invalid Client ID") {
		t.Fatalf("expected a rejection error, got %v", err)
	}
}

func TestValidateHandshakeAnswersPing(t *testing.T) {
	conn := &chunkedConn{
		data: append(
			encode(opPing, "keepalive"),
			encode(opFrame, map[string]interface{}{"cmd": "DISPATCH", "evt": "READY"})...,
		),
	}

	if err := validateHandshake(conn); err != nil {
		t.Fatalf("validateHandshake() = %v", err)
	}

	pong := &chunkedConn{data: conn.writes.Bytes()}
	opcode, payload, err := readFrame(pong)
	if err != nil {
		t.Fatal(err)
	}
	if opcode != opPong {
		t.Fatalf("opcode = %d, want PONG", opcode)
	}
	if string(payload) != `"keepalive"` {
		t.Fatalf("payload = %s", payload)
	}
}
