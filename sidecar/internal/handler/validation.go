package handler

import "fmt"

func bindPayload[T any](ctx *Context) (T, error) {
	var payload T
	if err := ctx.Bind(&payload); err != nil {
		return payload, err
	}
	return payload, nil
}

func requireParam(name string, value string) error {
	if value == "" {
		return errMissingParam(name)
	}
	return nil
}

func errMissingParam(name string) error {
	return fmt.Errorf("缺少必填参数: %s", name)
}
