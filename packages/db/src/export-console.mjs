import { generateConsoleSql } from './console-sql.mjs';

try {
  if (process.argv.length !== 3) throw new Error('Usage : export-console.mjs <nom-de-la-base>');
  process.stdout.write(await generateConsoleSql(process.argv[2]));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
