package handler

type remoteAuthPayload struct {
	Remote      string `json:"remote"`
	Username    string `json:"username"`
	Password    string `json:"password"`
	SSHKeyPath  string `json:"sshKeyPath"`
	SSHPassword string `json:"sshPassword"`
}

type remoteAddPayload struct {
	Name string `json:"name"`
	URL  string `json:"url"`
}

type remoteSetURLPayload struct {
	Name string `json:"name"`
	URL  string `json:"url"`
}

type remoteRemovePayload struct {
	Name string `json:"name"`
}
