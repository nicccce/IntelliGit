package handler

type sidecarPingResult struct {
	OK              bool `json:"ok"`
	ProtocolVersion int  `json:"protocolVersion"`
}
