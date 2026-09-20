export function environmentOptionLabel(environment) {
  const name = String(environment?.name || '').trim()
  const address = String(environment?.ip || '').trim()
  if (!name) return address
  if (!address || name.toLowerCase() === address.toLowerCase()) return name
  return name + ' · ' + address
}
