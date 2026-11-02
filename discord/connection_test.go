//go:build !windows

package discord

import (
	"encoding/json"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

type fakeOptions struct {
	errorOnSet          bool
	closeAfterHandshake bool
	pingOnce            bool
}

type fakeDiscord struct {
	listener   net.Listener
	options    fakeOptions
	handshakes atomic.Int32
	updates    atomic.Int32
	pongs      atomic.Int32
}

func startFakeDiscord(t *testing.T, options fakeOptions) *fakeDiscord {
	t.Helper()

	// Keep the path short: macOS caps Unix socket paths at about 104 bytes,
	// and t.TempDir() includes the test name.
	directory, err := os.MkdirTemp("/tmp", "ocdisc-")
	if err != nil {
		t.Fatalf("temp dir: %v", err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(directory) })

	path := filepath.Join(directory, "discord-ipc-0")
	listener, err := net.Listen("unix", path)
	if err != nil {
		t.Fatalf("listen: %v", err)
	}

	fake := &fakeDiscord{listener: listener, options: options}
	go fake.serve()

	t.Cleanup(func() { _ = listener.Close() })
	t.Setenv("DISCORD_IPC_PATH", path)
	return fake
}

func (f *fakeDiscord) serve() {
	for {
		conn, err := f.listener.Accept()
		if err != nil {
			return
		}
		go f.handle(conn)
	}
}

func (f *fakeDiscord) handle(conn net.Conn) {
	defer conn.Close()

	opcode, _, err := readFrame(conn)
	if err != nil || opcode != opHandshake {
		return
	}
	f.handshakes.Add(1)

	if err := writeFrame(conn, opFrame, map[string]interface{}{
		"cmd": "DISPATCH",
		"evt": "READY",
	}); err != nil {
		return
	}

	if f.options.pingOnce {
		if err := writeFrame(conn, opPing, "keepalive"); err != nil {
			return
		}
		if code, _, err := readFrame(conn); err == nil && code == opPong {
			f.pongs.Add(1)
		}
	}

	if f.options.closeAfterHandshake {
		return
	}

	for {
		code, payload, err := readFrame(conn)
		if err != nil {
			return
		}
		if code != opFrame {
			continue
		}

		var request struct {
			Cmd   string `json:"cmd"`
			Nonce string `json:"nonce"`
		}
		if err := json.Unmarshal(payload, &request); err != nil || request.Cmd != "SET_ACTIVITY" {
			continue
		}

		f.updates.Add(1)
		if f.options.errorOnSet {
			_ = writeFrame(conn, opFrame, map[string]interface{}{
				"cmd":   "SET_ACTIVITY",
				"evt":   "ERROR",
				"nonce": request.Nonce,
				"data": map[string]interface{}{
					"code":    4001,
					"message": "rate limited",
				},
			})
			continue
		}

		_ = writeFrame(conn, opFrame, map[string]interface{}{
			"cmd":   "SET_ACTIVITY",
			"evt":   nil,
			"nonce": request.Nonce,
			"data":  nil,
		})
	}
}

func waitFor(t *testing.T, label string, condition func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if condition() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", label)
}

func TestSetActivityAndClear(t *testing.T) {
	fake := startFakeDiscord(t, fakeOptions{})
	client := NewClient("123456789012345678")
	t.Cleanup(func() { _ = client.Close() })

	if err := client.Connect(); err != nil {
		t.Fatalf("Connect: %v", err)
	}
	if err := client.SetActivity(Activity{Details: "Working"}); err != nil {
		t.Fatalf("SetActivity: %v", err)
	}
	if err := client.ClearActivity(); err != nil {
		t.Fatalf("ClearActivity: %v", err)
	}

	waitFor(t, "two updates", func() bool { return fake.updates.Load() == 2 })
}

func TestSetActivitySurfacesDiscordError(t *testing.T) {
	startFakeDiscord(t, fakeOptions{errorOnSet: true})
	client := NewClient("123456789012345678")
	t.Cleanup(func() { _ = client.Close() })

	if err := client.Connect(); err != nil {
		t.Fatalf("Connect: %v", err)
	}

	err := client.SetActivity(Activity{Details: "Working"})
	if err == nil || !strings.Contains(err.Error(), "rate limited") {
		t.Fatalf("SetActivity error = %v", err)
	}
}

func TestClientMarksDisconnectedWhenServerCloses(t *testing.T) {
	fake := startFakeDiscord(t, fakeOptions{closeAfterHandshake: true})
	client := NewClient("123456789012345678")
	t.Cleanup(func() { _ = client.Close() })

	if err := client.Connect(); err != nil {
		t.Fatalf("Connect: %v", err)
	}

	waitFor(t, "disconnect", func() bool { return !client.Connected() })

	if err := client.Reconnect(); err != nil {
		t.Fatalf("Reconnect: %v", err)
	}
	waitFor(t, "second handshake", func() bool { return fake.handshakes.Load() == 2 })
}

func TestReadLoopAnswersPing(t *testing.T) {
	fake := startFakeDiscord(t, fakeOptions{pingOnce: true})
	client := NewClient("123456789012345678")
	t.Cleanup(func() { _ = client.Close() })

	if err := client.Connect(); err != nil {
		t.Fatalf("Connect: %v", err)
	}

	waitFor(t, "pong", func() bool { return fake.pongs.Load() == 1 })
}
