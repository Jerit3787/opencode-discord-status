package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"math"
	"path/filepath"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

// sessionQuery returns the newest sessions plus their last assistant message.
//
// OpenCode V2 keeps current sessions in `session_v2` / `session_message`; the
// `session`, `message`, and `part` tables are the V1 layout.
const sessionQuery = `select
  s.id,
  coalesce(s.directory, ''),
  coalesce(s.model, ''),
  coalesce(s.agent, ''),
  coalesce(s.cost, 0),
  coalesce(s.tokens_input, 0),
  coalesce(s.tokens_output, 0),
  coalesce(s.time_updated, 0),
  coalesce(m.data, ''),
  coalesce((
    select max(u.time_created)
    from session_message u
    where u.session_id = s.id and u.type = 'user'
  ), 0)
from session_v2 s
left join session_message m on m.id = (
  select id from session_message
  where session_id = s.id and type = 'assistant'
  order by seq desc limit 1
)
where s.time_archived is null
order by s.time_updated desc
limit 20`

// SessionRow is one row of sessionQuery.
type SessionRow struct {
	SessionID    string
	Directory    string
	Model        string
	Agent        string
	Cost         float64
	TokensInput  int64
	TokensOutput int64
	TimeUpdated  int64
	Message      string
	// TurnStarted is the latest user message time for this session, which
	// stays fixed while the assistant works through steps.
	TurnStarted int64
}

type messageData struct {
	Time struct {
		Created   int64 `json:"created"`
		Streamed  int64 `json:"streamed"`
		Completed int64 `json:"completed"`
	} `json:"time"`
	Finish string `json:"finish"`
	Agent  string `json:"agent"`
	Model  struct {
		ID string `json:"id"`
	} `json:"model"`
}

// Snapshot is what the card should show.
type Snapshot struct {
	SessionID string
	Busy      bool
	Project   string
	Model     string
	Agent     string
	Cost      float64
	Tokens    int64
	StartedAt time.Time
	Updated   int64
}

func readSessions(dbPath string) ([]SessionRow, error) {
	database, err := sql.Open("sqlite", "file:"+dbPath+"?mode=ro")
	if err != nil {
		return nil, err
	}
	defer database.Close()

	rows, err := database.Query(sessionQuery)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var sessions []SessionRow
	for rows.Next() {
		var row SessionRow
		if err := rows.Scan(
			&row.SessionID,
			&row.Directory,
			&row.Model,
			&row.Agent,
			&row.Cost,
			&row.TokensInput,
			&row.TokensOutput,
			&row.TimeUpdated,
			&row.Message,
			&row.TurnStarted,
		); err != nil {
			return nil, err
		}
		sessions = append(sessions, row)
	}

	return sessions, rows.Err()
}

func analyze(row SessionRow, now time.Time, idleAfter time.Duration) Snapshot {
	message := parseMessage(row.Message)
	updated := time.UnixMilli(row.TimeUpdated)
	fresh := row.TimeUpdated > 0 && now.Sub(updated) <= idleAfter
	streaming := message != nil && message.Time.Completed == 0 && message.Finish == ""
	waitingOnTools := message != nil && message.Finish == "tool-calls"
	busy := fresh && (streaming || waitingOnTools)

	project := ""
	if row.Directory != "" {
		project = filepath.Base(row.Directory)
	}

	modelID := modelIDFromJSON(row.Model)
	if modelID == "" && message != nil {
		modelID = message.Model.ID
	}

	agent := row.Agent
	if agent == "" && message != nil {
		agent = message.Agent
	}

	snapshot := Snapshot{
		SessionID: row.SessionID,
		Busy:      busy,
		Project:   project,
		Model:     formatModelName(modelID),
		Agent:     agent,
		Cost:      row.Cost,
		Tokens:    row.TokensInput + row.TokensOutput,
		Updated:   row.TimeUpdated,
	}
	if busy {
		started := row.TurnStarted
		if started == 0 && message != nil {
			started = message.Time.Created
		}
		if started > 0 {
			snapshot.StartedAt = time.UnixMilli(started)
		}
	}

	return snapshot
}

// pickSession chooses the card owner: busy beats idle, then the most recently
// written wins. An incumbent is kept unless another session is clearly newer,
// so two working sessions do not flicker.
func pickSession(
	rows []SessionRow,
	now time.Time,
	idleAfter time.Duration,
	incumbent string,
	switchMargin time.Duration,
) *Snapshot {
	var best *Snapshot

	for i := range rows {
		candidate := analyze(rows[i], now, idleAfter)
		if best == nil ||
			(candidate.Busy && !best.Busy) ||
			(candidate.Busy == best.Busy && candidate.Updated > best.Updated) {
			copied := candidate
			best = &copied
		}
	}

	if best == nil {
		return nil
	}

	if incumbent == "" {
		return best
	}

	for i := range rows {
		if rows[i].SessionID != incumbent {
			continue
		}

		current := analyze(rows[i], now, idleAfter)
		if current.Busy && !best.Busy {
			return &current
		}
		if current.Busy == best.Busy && best.Updated-current.Updated < switchMargin.Milliseconds() {
			return &current
		}
		break
	}

	return best
}

// formatModelName turns `deepseek-v4.1-flash` into `DeepSeek V4.1 Flash`.
func formatModelName(id string) string {
	if id == "" {
		return ""
	}

	parts := strings.FieldsFunc(id, func(r rune) bool {
		return r == '-' || r == '_' || r == '/'
	})
	if len(parts) == 0 {
		return id
	}

	for i, part := range parts {
		lower := strings.ToLower(part)
		if brand, ok := modelBrands[lower]; ok {
			parts[i] = brand
			continue
		}
		if isVersion(lower) {
			if strings.HasPrefix(lower, "v") {
				parts[i] = "V" + lower[1:]
			} else {
				parts[i] = lower
			}
			continue
		}
		parts[i] = strings.ToUpper(lower[:1]) + lower[1:]
	}

	return strings.Join(parts, " ")
}

var modelBrands = map[string]string{
	"deepseek": "DeepSeek",
	"openai":   "OpenAI",
	"gpt":      "GPT",
	"glm":      "GLM",
	"kimi":     "Kimi",
	"minimax":  "MiniMax",
	"claude":   "Claude",
	"gemini":   "Gemini",
	"qwen":     "Qwen",
	"llama":    "Llama",
	"mistral":  "Mistral",
	"grok":     "Grok",
	"mimo":     "MiMo",
}

func isVersion(value string) bool {
	value = strings.TrimPrefix(value, "v")
	if value == "" {
		return false
	}
	for _, part := range strings.Split(value, ".") {
		if part == "" {
			return false
		}
		for _, r := range part {
			if r < '0' || r > '9' {
				return false
			}
		}
	}
	return true
}

func formatTokens(tokens int64) string {
	switch {
	case tokens >= 1_000_000:
		return fmt.Sprintf("%.1fM", float64(tokens)/1_000_000)
	case tokens >= 1_000:
		thousands := float64(tokens) / 1_000
		if thousands >= 999.95 {
			return "1.0M"
		}
		return fmt.Sprintf("%.1fK", thousands)
	default:
		return fmt.Sprintf("%d", tokens)
	}
}

func formatCost(cost float64) string {
	if math.IsNaN(cost) || math.IsInf(cost, 0) || cost <= 0 {
		return "$0.00"
	}
	if cost >= 1 {
		return fmt.Sprintf("$%.2f", cost)
	}

	value := fmt.Sprintf("%.4f", cost)
	value = strings.TrimRight(value, "0")
	if strings.HasSuffix(value, ".") {
		value += "00"
	} else if decimals := len(value) - strings.Index(value, ".") - 1; decimals < 2 {
		value += strings.Repeat("0", 2-decimals)
	}
	return "$" + value
}

func parseMessage(value string) *messageData {
	if value == "" {
		return nil
	}
	var message messageData
	if err := json.Unmarshal([]byte(value), &message); err != nil {
		return nil
	}
	return &message
}

func modelIDFromJSON(value string) string {
	if value == "" {
		return ""
	}
	var model struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal([]byte(value), &model); err != nil {
		return ""
	}
	return model.ID
}
