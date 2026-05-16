package git

import "strings"

func parseConflictedFiles(output string) []string {
	var files []string
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "CONFLICT") && strings.Contains(line, "Merge conflict in ") {
			idx := strings.Index(line, "Merge conflict in ")
			if idx >= 0 {
				file := strings.TrimSpace(line[idx+len("Merge conflict in "):])
				if file != "" {
					files = append(files, file)
				}
			}
		}
	}
	return files
}
