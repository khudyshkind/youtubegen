import { useStudioStore } from './studio-store'

/**
 * Returns true when the caller should proceed with generation.
 * If the loaded project was completed, shows a native confirm dialog first.
 * Pass the localised confirmation message from the calling component's t().
 */
export function confirmRegenIfCompleted(message: string): boolean {
  const { projectStatus } = useStudioStore.getState()
  if (projectStatus !== 'completed') return true
  return window.confirm(message)
}
