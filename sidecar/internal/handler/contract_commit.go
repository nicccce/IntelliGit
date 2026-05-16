package handler

type commitCreatePayload struct {
	Message     string `json:"message"`
	AuthorName  string `json:"authorName"`
	AuthorEmail string `json:"authorEmail"`
}

type commitLogPayload struct {
	Max  int    `json:"max"`
	From string `json:"from"`
}

type commitHashPayload struct {
	Hash string `json:"hash"`
}

type commitResetPayload struct {
	Hash string `json:"hash"`
	Mode string `json:"mode"`
}

type commitLogAllPayload struct {
	Max int `json:"max"`
}

type commitHashResult struct {
	Hash string `json:"hash"`
}
