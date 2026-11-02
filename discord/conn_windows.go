//go:build windows

package discord

import (
	"fmt"
	"time"

	"github.com/Microsoft/go-winio"
)

func (c *Client) connectToDiscord() (Conn, error) {
	timeout := 5 * time.Second

	for i := 0; i < 10; i++ {
		pipePath := fmt.Sprintf(`\\.\pipe\discord-ipc-%d`, i)
		conn, err := winio.DialPipe(pipePath, &timeout)
		if err == nil {
			return conn, nil
		}
	}
	return nil, fmt.Errorf("Discord IPC pipe not found. Make sure Discord is running")
}
