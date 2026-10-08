import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const template = await readFile('.env.example', 'utf8');
const password = randomBytes(24).toString('hex');
try {
  await writeFile('.env', template.replaceAll('replace-with-local-password', password), {
    flag: 'wx',
    mode: 0o600,
  });
  console.log(
    'Created local .env. Infrastructure password generated; external credentials are empty.',
  );
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  console.log('Existing .env retained.');
}
