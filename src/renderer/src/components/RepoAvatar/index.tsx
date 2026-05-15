import type { JSX } from 'react'

import { repoInitials } from '../../utils/repoName'

interface RepoAvatarProps {
  name: string
}

function RepoAvatar({ name }: RepoAvatarProps): JSX.Element {
  return <span className="ig-repo-initials">{repoInitials(name)}</span>
}

export default RepoAvatar
