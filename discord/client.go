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

const (
	handshakeTimeout = 10 * time.Second
	requestTimeout   = 10 * time.Second
	maxFrameBytes    = 1 << 20
)

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

	pendingMu sync.Mutex
	pending   map[string]chan error
}

// NewClient creates a new Discord RPC client.
func NewClient(clientID string) *Client {
	return &Client{
		clientID: clientID,
		pending:  make(map[string]chan error),
	}
}

// Connected reports whether a live socket is attached.
func (c *Client) Connected() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.conn != nil
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

// readLoop drains responses, answers PINGs, and marks the client disconnected
// when the socket goes away.
func (c *Client) readLoop(conn Conn) {
	defer c.disconnected(conn)

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
			c.handleResponse(payload)
		}
	}
}

func (c *Client) handleResponse(payload []byte) {
	var frame struct {
		Evt   string          `json:"evt"`
		Nonce string          `json:"nonce"`
		Data  json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(payload, &frame); err != nil || frame.Nonce == "" {
		return
	}

	if frame.Evt == "ERROR" {
		var rejected struct {
			Code    int    `json:"code"`
			Message string `json:"message"`
		}
		_ = json.Unmarshal(frame.Data, &rejected)
		c.resolve(frame.Nonce, fmt.Errorf("%s (code %d)", rejected.Message, rejected.Code))
		return
	}

	c.resolve(frame.Nonce, nil)
}

func (c *Client) disconnected(conn Conn) {
	c.mu.Lock()
	if c.conn == conn {
		c.conn = nil
	}
	c.mu.Unlock()
	c.failPending(fmt.Errorf("Discord connection closed"))
}

// Reconnect closes any existing connection and establishes a fresh one.
func (c *Client) Reconnect() error {
	_ = c.Close()
	return c.Connect()
}

// SetActivity updates the Discord Rich Presence and waits for Discord's reply.
func (c *Client) SetActivity(activity Activity) error {
	return c.request("SET_ACTIVITY", map[string]interface{}{
		"pid":      os.Getpid(),
		"activity": activityData(activity),
	})
}

func activityData(activity Activity) map[string]interface{} {
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
	return activityData
}

// ClearActivity removes the presence from the profile and waits for Discord.
func (c *Client) ClearActivity() error {
	return c.request("SET_ACTIVITY", map[string]interface{}{
		"pid":      os.Getpid(),
		"activity": nil,
	})
}

// Close disconnects from Discord and fails any in-flight requests.
func (c *Client) Close() error {
	c.mu.Lock()
	conn := c.conn
	c.conn = nil
	c.mu.Unlock()

	c.failPending(fmt.Errorf("Discord connection closed"))

	if conn != nil {
		return conn.Close()
	}
	return nil
}

func (c *Client) request(command string, arguments map[string]interface{}) error {
	nonce := fmt.Sprintf("%d", time.Now().UnixNano())
	result := make(chan error, 1)

	c.pendingMu.Lock()
	c.pending[nonce] = result
	c.pendingMu.Unlock()

	defer func() {
		c.pendingMu.Lock()
		delete(c.pending, nonce)
		c.pendingMu.Unlock()
	}()

	if err := c.send(opFrame, map[string]interface{}{
		"cmd":   command,
		"args":  arguments,
		"nonce": nonce,
	}); err != nil {
		return err
	}

	select {
	case err := <-result:
		return err
	case <-time.After(requestTimeout):
		return fmt.Errorf("Discord did not answer %s in time", command)
	}
}

func (c *Client) resolve(nonce string, err error) {
	c.pendingMu.Lock()
	result := c.pending[nonce]
	delete(c.pending, nonce)
	c.pendingMu.Unlock()

	if result == nil {
		return
	}
	select {
	case result <- err:
	default:
	}
}

func (c *Client) failPending(err error) {
	c.pendingMu.Lock()
	pending := c.pending
	c.pending = make(map[string]chan error)
	c.pendingMu.Unlock()

	for _, result := range pending {
		select {
		case result <- err:
		default:
		}
	}
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
	if length > maxFrameBytes {
		return 0, nil, fmt.Errorf("Discord IPC frame too large: %d bytes", length)
	}

	payload := make([]byte, length)
	if _, err := io.ReadFull(conn, payload); err != nil {
		return 0, nil, err
	}

	return opcode, payload, nil
}
