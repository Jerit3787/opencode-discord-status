package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	consoleRefreshInterval = 10 * time.Minute
	consoleRequestTimeout  = 12 * time.Second
)

// consoleCredential is the OpenCode Console OAuth entry stored in
// `credential.value`. The access token is local to this machine.
type consoleCredential struct {
	Access   string `json:"access"`
	Expires  int64  `json:"expires"`
	Metadata struct {
		Server string `json:"server"`
		OrgID  string `json:"orgID"`
	} `json:"metadata"`
}

type consoleModelUsage struct {
	Model                   string `json:"model"`
	Provider                string `json:"provider"`
	TotalCostMicroCents     string `json:"totalCostMicroCents"`
	TotalInputTokens        string `json:"totalInputTokens"`
	TotalOutputTokens       string `json:"totalOutputTokens"`
	TotalCacheReadTokens    string `json:"totalCacheReadTokens"`
	TotalCacheWrite5mTokens string `json:"totalCacheWrite5mTokens"`
	TotalCacheWrite1hTokens string `json:"totalCacheWrite1hTokens"`
}

type costEstimator struct {
	mu        sync.Mutex
	rates     map[string]float64 // "provider/model" -> dollars per token
	fetchedAt time.Time
	fetching  bool
}

var estimator = &costEstimator{}

// RefreshIfStale starts one background fetch per interval. The tick never
// blocks on the Console API.
func (e *costEstimator) RefreshIfStale(dbPath string) {
	e.mu.Lock()
	if e.fetching || time.Since(e.fetchedAt) < consoleRefreshInterval {
		e.mu.Unlock()
		return
	}
	e.fetching = true
	e.mu.Unlock()

	go func() {
		rates, err := fetchConsoleRates(dbPath)
		e.mu.Lock()
		e.fetching = false
		if err == nil {
			e.rates = rates
			e.fetchedAt = time.Now()
		}
		e.mu.Unlock()
	}()
}

// RefreshNow blocks until the rates are refreshed. Used by -once.
func (e *costEstimator) RefreshNow(dbPath string) {
	rates, err := fetchConsoleRates(dbPath)
	if err != nil {
		return
	}
	e.mu.Lock()
	e.rates = rates
	e.fetchedAt = time.Now()
	e.mu.Unlock()
}

// Apply fills in an estimated cost when OpenCode reports zero for the session.
// The rate is the Console's average cost per token for this model.
func (e *costEstimator) Apply(snapshot *Snapshot) {
	if snapshot == nil || snapshot.Cost > 0 || snapshot.AllTokens <= 0 {
		return
	}

	e.mu.Lock()
	rate, ok := e.rates[snapshot.ProviderID+"/"+snapshot.ModelID]
	e.mu.Unlock()
	if !ok {
		return
	}

	snapshot.Cost = rate * float64(snapshot.AllTokens)
	snapshot.CostEstimated = true
}

func fetchConsoleRates(dbPath string) (map[string]float64, error) {
	credential, err := readConsoleCredential(dbPath)
	if err != nil {
		return nil, err
	}
	if credential.Access == "" {
		return nil, fmt.Errorf("no Console access token")
	}
	if credential.Expires > 0 && time.Now().UnixMilli() >= credential.Expires {
		return nil, fmt.Errorf("Console token expired")
	}

	server := strings.TrimRight(credential.Metadata.Server, "/")
	if server == "" {
		return nil, fmt.Errorf("Console server missing")
	}

	request, err := http.NewRequest("GET", server+"/api/usage/models?range=30d&pageSize=100", nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Authorization", "Bearer "+credential.Access)
	request.Header.Set("x-org-id", credential.Metadata.OrgID)
	request.Header.Set("Accept", "application/json")
	request.Header.Set("User-Agent", "opencode-discord-status/1.1")

	client := &http.Client{Timeout: consoleRequestTimeout}
	response, err := client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("Console usage returned HTTP %d", response.StatusCode)
	}

	var payload struct {
		Items []consoleModelUsage `json:"items"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return nil, err
	}

	return ratesFromConsoleModels(payload.Items), nil
}

// ratesFromConsoleModels turns Console activity into dollars per token. The
// Console reports micro-cents for the period; cache reads are included because
// they are part of the billed cost.
func ratesFromConsoleModels(models []consoleModelUsage) map[string]float64 {
	rates := make(map[string]float64)

	for _, model := range models {
		cost := float64(parseInt64(model.TotalCostMicroCents)) / 1e8
		tokens := parseInt64(model.TotalInputTokens) +
			parseInt64(model.TotalOutputTokens) +
			parseInt64(model.TotalCacheReadTokens) +
			parseInt64(model.TotalCacheWrite5mTokens) +
			parseInt64(model.TotalCacheWrite1hTokens)

		if cost <= 0 || tokens <= 0 || model.Provider == "" || model.Model == "" {
			continue
		}
		rates[model.Provider+"/"+model.Model] = cost / float64(tokens)
	}

	return rates
}

func parseInt64(value string) int64 {
	parsed, _ := strconv.ParseInt(value, 10, 64)
	return parsed
}

func readConsoleCredential(dbPath string) (*consoleCredential, error) {
	database, err := sql.Open("sqlite", "file:"+dbPath+"?mode=ro")
	if err != nil {
		return nil, err
	}
	defer database.Close()

	var raw string
	err = database.QueryRow(
		"select value from credential where integration_id = 'opencode' and active = 1 order by time_updated desc limit 1",
	).Scan(&raw)
	if err != nil {
		return nil, err
	}

	var credential consoleCredential
	if err := json.Unmarshal([]byte(raw), &credential); err != nil {
		return nil, err
	}
	return &credential, nil
}
