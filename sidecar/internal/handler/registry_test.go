package handler

import "testing"

func TestRegisterAllRegistersEveryKnownCommand(t *testing.T) {
	router := NewRouter(nil)
	RegisterAll(router)

	commands := []string{
		CommandSidecarPing,
		CommandRepoOpen,
		CommandRepoInit,
		CommandRepoClone,
		CommandRepoHead,
		CommandRepoIsClean,
		CommandStagingStatus,
		CommandStagingAdd,
		CommandStagingAddAll,
		CommandStagingRemove,
		CommandStagingRestore,
		CommandStagingApplyPatch,
		CommandStagingUnstageHunk,
		CommandCommitCreate,
		CommandCommitLog,
		CommandCommitGet,
		CommandCommitReset,
		CommandCommitCheckoutCommit,
		CommandCommitLogAll,
		CommandBranchList,
		CommandBranchListRemote,
		CommandBranchCurrent,
		CommandBranchAheadBehind,
		CommandBranchCreate,
		CommandBranchDelete,
		CommandBranchCheckout,
		CommandBranchCheckoutNew,
		CommandRemoteList,
		CommandRemoteAdd,
		CommandRemoteSetURL,
		CommandRemoteRemove,
		CommandRemoteFetch,
		CommandRemotePull,
		CommandRemotePush,
		CommandMergeStatus,
		CommandMergeAbort,
		CommandMergeContinue,
		CommandMergeShadow,
		CommandMergeStageContent,
		CommandConflictResolve,
		CommandDiffCommits,
		CommandDiffWithParent,
		CommandDiffCommitPatch,
		CommandDiffFileContent,
		CommandDiffListFiles,
		CommandDiffWorkdir,
		CommandDiffStaged,
		CommandDiffWorkdirRaw,
		CommandDiffStagedRaw,
	}

	if len(router.handlers) != len(commands) {
		t.Fatalf("expected %d registered commands, got %d", len(commands), len(router.handlers))
	}
	for _, command := range commands {
		if router.handlers[command] == nil {
			t.Fatalf("command %q was not registered", command)
		}
	}
}
