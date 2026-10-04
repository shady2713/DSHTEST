import { FileStoreLease } from '../../lib/types/file-lease.js'

const lease = await FileStoreLease.acquire(process.argv[2])
process.stdout.write('holding\n')
setInterval(() => { void lease }, 1000)
