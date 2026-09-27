function resetBootstrapAdminPassword() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet()
  if (!spreadsheet) throw new Error('Open the inventory Google Sheet before running this function.')

  const props = PropertiesService.getScriptProperties()
  props.setProperty('SPREADSHEET_ID', spreadsheet.getId())

  ensureSheet_(spreadsheet, TAB.USERS, HEADERS[TAB.USERS])
  ensureSheet_(spreadsheet, TAB.AUDIT, HEADERS[TAB.AUDIT])

  if (!props.getProperty('AUTH_PEPPER')) {
    props.setProperty('AUTH_PEPPER', Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''))
  }

  let admin = findUserByUsername_('admin')
  const temporaryPassword = temporaryPassword_()

  if (!admin) {
    admin = createUserRecord_('admin', 'Administrator', 'admin', temporaryPassword, true)
  } else {
    const salt = newSalt_()
    admin.role = 'admin'
    admin.active = true
    admin.salt = salt
    admin.passwordHash = hashPassword_(temporaryPassword, salt)
    admin.mustChangePassword = true
    admin.updatedAt = new Date().toISOString()
    upsertObject_(TAB.USERS, HEADERS[TAB.USERS], admin)
    revokeUserSessions_(admin.id)
  }

  audit_(publicUser_(admin), 'ADMIN_PASSWORD_RECOVERY', 'Password reset from Apps Script editor')

  SpreadsheetApp.getUi().alert(
    'Admin password reset',
    'Username: admin\n\nTemporary password: ' + temporaryPassword +
      '\n\nCopy this password now. Sign in with it, then the app will require you to create a new password.',
    SpreadsheetApp.getUi().ButtonSet.OK
  )
}
