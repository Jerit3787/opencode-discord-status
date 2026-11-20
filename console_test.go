package main

import (
	"math"
	"testing"
)

func TestRatesFromConsoleModels(t *testing.T) {
	models := []consoleModelUsage{
		{
			Model:                   "deepseek-v4.1-flash",
			Provider:                "opencode-go",
			TotalCostMicroCents:     "100000000", // $1
			TotalInputTokens:        "600000",
			TotalOutputTokens:       "400000",
			TotalCacheReadTokens:    "0",
			TotalCacheWrite5mTokens: "0",
			TotalCacheWrite1hTokens: "0",
		},
		{
			Model:               "free-model",
			Provider:            "opencode-go",
			TotalCostMicroCents: "0",
			TotalInputTokens:    "1000",
		},
	}

	rates := ratesFromConsoleModels(models)

	got, ok := rates["opencode-go/deepseek-v4.1-flash"]
	if !ok {
		t.Fatal("missing deepseek rate")
	}
	if math.Abs(got-1e-6) > 1e-12 {
		t.Errorf("rate = %g, want 1e-6", got)
	}

	if _, ok := rates["opencode-go/free-model"]; ok {
		t.Error("zero-cost model should not have a rate")
	}
}

func TestRatesIncludeCacheTokens(t *testing.T) {
	rates := ratesFromConsoleModels([]consoleModelUsage{
		{
			Model:                   "m",
			Provider:                "p",
			TotalCostMicroCents:     "200000000", // $2
			TotalInputTokens:        "1000000",
			TotalOutputTokens:       "0",
			TotalCacheReadTokens:    "1000000",
			TotalCacheWrite5mTokens: "0",
			TotalCacheWrite1hTokens: "0",
		},
	})

	// $2 over input (1M) + cache read (1M) = 2M tokens.
	if got, want := rates["p/m"], 1e-6; math.Abs(got-want) > 1e-12 {
		t.Errorf("rate = %g, want %g", got, want)
	}
}
