package handler

import (
	"testing"

	"intelligit-sidecar/internal/protocol"
)

func TestHandleSidecarPing(t *testing.T) {
	router := NewRouter(nil)
	registerSystemHandlers(router)

	response := router.Dispatch(&protocol.Request{
		ID:      "ping",
		Command: CommandSidecarPing,
	})

	if !response.Success {
		t.Fatalf("expected ping to succeed, got error %q", response.Error)
	}

	result, ok := response.Data.(sidecarPingResult)
	if !ok {
		t.Fatalf("expected sidecarPingResult, got %T", response.Data)
	}
	if !result.OK {
		t.Fatal("expected ping result ok=true")
	}
	if result.ProtocolVersion != sidecarProtocolVersion {
		t.Fatalf("expected protocol version %d, got %d", sidecarProtocolVersion, result.ProtocolVersion)
	}
}
