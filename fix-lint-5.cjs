const fs = require('fs');
let bookApi = fs.readFileSync('./src/services/bookApi.ts', 'utf8');
bookApi = bookApi
  .split('\n')
  .map((line, i) => {
    if (i === 98 || i === 255) {
      return (
        '  // eslint-disable-next-line @typescript-eslint/no-unused-vars\n' +
        line
      );
    }
    return line;
  })
  .join('\n');
fs.writeFileSync('./src/services/bookApi.ts', bookApi);

let gemini = fs.readFileSync('./src/services/gemini.ts', 'utf8');
gemini = gemini
  .split('\n')
  .map((line, i) => {
    if (i === 555) {
      return (
        '    // eslint-disable-next-line @typescript-eslint/no-unused-vars\n' +
        line
      );
    }
    return line;
  })
  .join('\n');
fs.writeFileSync('./src/services/gemini.ts', gemini);
