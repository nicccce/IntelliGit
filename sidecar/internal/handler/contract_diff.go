package handler

type diffCommitsPayload struct {
	HashA string `json:"hashA"`
	HashB string `json:"hashB"`
}

type diffHashPayload struct {
	Hash string `json:"hash"`
}

type diffFileContentPayload struct {
	Hash string `json:"hash"`
	Path string `json:"path"`
}

type diffPathPayload struct {
	Path string `json:"path"`
}

type diffFileContentResult struct {
	Content string `json:"content"`
}

type diffRawResult struct {
	Diff string `json:"diff"`
}
