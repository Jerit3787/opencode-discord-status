// Package discord is a minimal Discord IPC client.
//
// Adapted from cc-discord-presence (MIT, Copyright (c) 2025 Vasant Paradissa
// Nuno Sakti). See THIRD_PARTY_NOTICES.md.
package discord

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"sync"
	"time"
)

// Discord IPC opcodes.
const (
	opHandshake = 0
	opFrame     = 1
	opClose     = 2
	opPing      = 3
	opPong      = 4
)

const handshakeTimeout = 10 * time.Second

// Activity is a Discord Rich Presence activity.
type Activity struct {
	Details    string     `json:"details,omitempty"`
	State      string     `json:"state,omitempty"`
	LargeImage string     `json:"large_image,omitempty"`
	LargeText  string     `json:"large_text,omitempty"`
	SmallImage string     `json:"small_image,omitempty"`
	SmallText  string     `json:"small_text,omitempty"`
	StartTime  *time.Time `json:"-"`
}

// Conn is the subset of a socket the client needs. Both net.Conn and
// winio's pipe satisfy it.
type Conn interface {
	Read(b []byte) (n int, err error)
	Write(b []byte) (n int, err error)
	Close() error
}

// Client handles the Discord RPC connection.
type Client struct {
	clientID string

	mu    sync.Mutex
	conn  Conn
	write sync.Mutex
}

// NewClient creates a new Discord RPC client.
func NewClient(clientID string) *Client {
	return &Client{clientID: clientID}
}

// Connect establishes the connection and completes the handshake.
func (c *Client) Connect() error {
	conn, err := c.connectToDiscord()
	if err != nil {
		return err
	}

	c.mu.Lock()
	c.conn = conn
	c.mu.Unlock()

	if err := c.send(opHandshake, map[string]interface{}{
		"v":         1,
		"client_id": c.clientID,
	}); err != nil {
		c.Close()
		return fmt.Errorf("handshake failed: %w", err)
	}

	if err := validateHandshake(conn); err != nil {
		c.Close()
		return err
	}

	go c.readLoop(conn)
	return nil
}

// validateHandshake waits for READY and fails on CLOSE or ERROR. PING frames
// are answered while waiting.
func validateHandshake(conn Conn) error {
	if setter, ok := conn.(interface{ SetReadDeadline(time.Time) error }); ok {
		_ = setter.SetReadDeadline(time.Now().Add(handshakeTimeout))
		defer setter.SetReadDeadline(time.Time{})
	}

	for {
		opcode, payload, err := readFrame(conn)
		if err != nil {
			return fmt.Errorf("handshake response failed: %w", err)
		}

		switch opcode {
		case opPing:
			if err := writeFrame(conn, opPong, json.RawMessage(payload)); err != nil {
				return err
			}
			continue
		case opClose:
			var closeData struct {
				Code    int    `json:"code"`
				Message string `json:"message"`
			}
			_ = json.Unmarshal(payload, &closeData)
			if closeData.Message == "" {
				closeData.Message = "Discord closed the connection"
			}
			return fmt.Errorf("Discord closed the handshake: %s (code %d)", closeData.Message, closeData.Code)
		case opFrame:
			var frame struct {
				Cmd  string          `json:"cmd"`
				Evt  string          `json:"evt"`
				Data json.RawMessage `json:"data"`
			}
			if err := json.Unmarshal(payload, &frame); err != nil {
				return fmt.Errorf("invalid handshake response: %w", err)
			}
			if frame.Evt == "ERROR" {
				var rejected struct {
					Code    int    `json:"code"`
					Message string `json:"message"`
				}
				_ = json.Unmarshal(frame.Data, &rejected)
				return fmt.Errorf("Discord rejected the handshake: %s (code %d)", rejected.Message, rejected.Code)
			}
			if frame.Evt == "READY" {
				return nil
			}
			return fmt.Errorf("unexpected handshake response: %s", string(payload))
		default:
			return fmt.Errorf("unexpected handshake opcode %d", opcode)
		}
	}
}

// readLoop drains responses and answers PINGs so a long-lived client does not
// fill the socket or get disconnected.
func (c *Client) readLoop(conn Conn) {
	for {
		opcode, payload, err := readFrame(conn)
		if err != nil {
			return
		}

		switch opcode {
		case opPing:
			c.write.Lock()
			_ = writeFrame(conn, opPong, json.RawMessage(payload))
			c.write.Unlock()
		case opClose:
			_ = conn.Close()
			return
		case opFrame:
			// A SET_ACTIVITY reply; nothing to do.
		}
	}
}

// Reconnect closes any existing connection and establishes a fresh one.
func (c *Client) Reconnect() error {
	_ = c.Close()
	return c.Connect()
}

// SetActivity updates the Discord Rich Presence.
func (c *Client) SetActivity(activity Activity) error {
	var timestamps map[string]int64
	if activity.StartTime != nil {
		timestamps = map[string]int64{"start": activity.StartTime.Unix()}
	}

	assets := map[string]string{}
	if activity.LargeImage != "" {
		assets["large_image"] = activity.LargeImage
	}
	if activity.LargeText != "" {
		assets["large_text"] = activity.LargeText
	}
	if activity.SmallImage != "" {
		assets["small_image"] = activity.SmallImage
	}
	if activity.SmallText != "" {
		assets["small_text"] = activity.SmallText
	}

	activityData := map[string]interface{}{}
	if activity.Details != "" {
		activityData["details"] = activity.Details
	}
	if activity.State != "" {
		activityData["state"] = activity.State
	}
	if len(assets) > 0 {
		activityData["assets"] = assets
	}
	if timestamps != nil {
		activityData["timestamps"] = timestamps
	}

	return c.send(opFrame, map[string]interface{}{
		"cmd": "SET_ACTIVITY",
		"args": map[string]interface{}{
			"pid":      os.Getpid(),
			"activity": activityData,
		},
		"nonce": fmt.Sprintf("%d", time.Now().UnixNano()),
	})
}

// ClearActivity removes the presence from the profile.
func (c *Client) ClearActivity() error {
	return c.send(opFrame, map[string]interface{}{
		"cmd": "SET_ACTIVITY",
		"args": map[string]interface{}{
			"pid":      os.Getpid(),
			"activity": nil,
		},
		"nonce": fmt.Sprintf("%d", time.Now().UnixNano()),
	})
}

// Close disconnects from Discord.
func (c *Client) Close() error {
	c.mu.Lock()
	conn := c.conn
	c.conn = nil
	c.mu.Unlock()

	if conn != nil {
		return conn.Close()
	}
	return nil
}

func (c *Client) send(opcode int, data interface{}) error {
	c.mu.Lock()
	conn := c.conn
	c.mu.Unlock()
	if conn == nil {
		return fmt.Errorf("not connected")
	}

	c.write.Lock()
	defer c.write.Unlock()
	return writeFrame(conn, opcode, data)
}

// receive is kept for the tests and handshake-free callers.
func (c *Client) receive() ([]byte, error) {
	c.mu.Lock()
	conn := c.conn
	c.mu.Unlock()
	if conn == nil {
		return nil, fmt.Errorf("not connected")
	}

	_, payload, err := readFrame(conn)
	return payload, err
}

func writeFrame(conn Conn, opcode int, data interface{}) error {
	payload, err := json.Marshal(data)
	if err != nil {
		return err
	}

	buf := new(bytes.Buffer)
	_ = binary.Write(buf, binary.LittleEndian, int32(opcode))
	_ = binary.Write(buf, binary.LittleEndian, int32(len(payload)))
	buf.Write(payload)

	_, err = conn.Write(buf.Bytes())
	return err
}

// readFrame uses io.ReadFull because a socket read may return a partial frame.
func readFrame(conn Conn) (int, []byte, error) {
	header := make([]byte, 8)
	if _, err := io.ReadFull(conn, header); err != nil {
		return 0, nil, err
	}

	opcode := int(binary.LittleEndian.Uint32(header[0:4]))
	length := binary.LittleEndian.Uint32(header[4:8])
	if length > 1<<20 {
		return 0, nil, fmt.Errorf("Discord IPC frame too large: %d bytes", length)
	}

	payload := make([]byte, length)
	if _, err := io.ReadFull(conn, payload); err != nil {
		return 0, nil, err
	}

	return opcode, payload, nil
}
