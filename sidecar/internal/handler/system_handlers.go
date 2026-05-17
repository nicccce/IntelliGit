package handler

const sidecarProtocolVersion = 1

func registerSystemHandlers(r *Router) {
	r.Register(CommandSidecarPing, handleSidecarPing)
}

func handleSidecarPing(_ *Context) (any, error) {
	return sidecarPingResult{
		OK:              true,
		ProtocolVersion: sidecarProtocolVersion,
	}, nil
}
