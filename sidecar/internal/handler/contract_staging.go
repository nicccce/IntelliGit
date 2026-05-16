package handler

type stagingPathPayload struct {
	Path string `json:"path"`
}

type stagingPatchPayload struct {
	Patch string `json:"patch"`
}
