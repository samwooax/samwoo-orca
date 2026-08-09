import React from 'react'
import { SidebarSettingsHelpMenu } from './SidebarSettingsHelpMenu'
import { OrcaProfileSwitcher } from '../orca-profiles/OrcaProfileSwitcher'

const SidebarToolbar = React.memo(function SidebarToolbar() {
  return (
    <div className="mt-auto shrink-0">
      <div className="flex items-center border-t border-worktree-sidebar-border px-2 py-1.5">
        <div className="flex min-w-0 items-center gap-1">
          <OrcaProfileSwitcher placement="sidebar" />
          <SidebarSettingsHelpMenu />
        </div>
      </div>
    </div>
  )
})

export default SidebarToolbar
