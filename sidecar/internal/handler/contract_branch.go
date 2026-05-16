package handler

type branchNamePayload struct {
	Name string `json:"name"`
}

type branchCheckoutPayload struct {
	Branch string `json:"branch"`
}

type branchCheckoutNewPayload struct {
	Branch    string `json:"branch"`
	StartFrom string `json:"startFrom"`
}

type branchAheadBehindPayload struct {
	Branch string `json:"branch"`
}

type branchCurrentResult struct {
	Branch string `json:"branch"`
}

type branchAheadBehindResult struct {
	Ahead  int `json:"ahead"`
	Behind int `json:"behind"`
}
