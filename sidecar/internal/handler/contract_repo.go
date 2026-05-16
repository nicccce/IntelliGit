package handler

type repoOpenPayload struct {
	Path string `json:"path"`
}

type repoInitPayload struct {
	Path string `json:"path"`
	Bare bool   `json:"bare"`
}

type repoClonePayload struct {
	URL    string `json:"url"`
	Path   string `json:"path"`
	Depth  int    `json:"depth"`
	Branch string `json:"branch"`
}

type repoPathResult struct {
	Path string `json:"path"`
}

type repoHeadResult struct {
	Hash   string `json:"hash"`
	Branch string `json:"branch"`
}

type repoCleanResult struct {
	Clean bool `json:"clean"`
}
