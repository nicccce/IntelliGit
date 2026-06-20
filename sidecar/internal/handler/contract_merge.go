package handler

type mergeContinuePayload struct {
	Message string `json:"message"`
}

type shadowMergePayload struct {
	TargetBranch string `json:"targetBranch"`
}

type stageContentPayload struct {
	Path string `json:"path"`
}

type stageContentResult struct {
	Ancestor string `json:"ancestor"`
	Ours     string `json:"ours"`
	Theirs   string `json:"theirs"`
	Binary   bool   `json:"binary"`
}

type conflictResolvePayload struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}
