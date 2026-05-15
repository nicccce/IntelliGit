import type { JSX } from 'react'

import { repoInitials } from '../../utils/repoName'
import styles from './RepoAvatar.module.css'

interface RepoAvatarProps {
  name: string
}

function RepoAvatar({ name }: RepoAvatarProps): JSX.Element {
  return <span className={styles['ig-repo-initials']}>{repoInitials(name)}</span>
}

export default RepoAvatar
