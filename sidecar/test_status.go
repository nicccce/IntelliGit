package main

import (
	"fmt"
	"log"
	"os"

	"intelligit-sidecar/internal/git"
)

func main() {
	repo, err := git.Open(os.Args[1])
	if err != nil {
		log.Fatal(err)
	}
	st, err := repo.Status()
	if err != nil {
		log.Fatal(err)
	}
	fmt.Printf("%+v\n", st)
}
