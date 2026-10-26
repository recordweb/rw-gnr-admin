import { hashPassword } from '../src/auth/adminAuth.js';

// Prints the line for the .env file. The password is read from the environment so that it does not
// appear in the shell history:  read -rs PASSWORD; export PASSWORD; node backend/tools/hash-password.js
const password = process.env.PASSWORD ?? '';
if (password.length < 12) {
  console.error('PASSWORD must be set and at least 12 characters long.');
  process.exit(1);
}
console.log(`ADMIN_PASSWORD_HASH=${hashPassword(password)}`);