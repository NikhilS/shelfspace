const fs = require('fs');
function fixCatchEmpty(fileName, searchStr) {
  let content = fs.readFileSync(fileName, 'utf8');
  content = content.replace(searchStr, 'catch {');
  content = content.replace(searchStr, 'catch {');
  fs.writeFileSync(fileName, content);
}
fixCatchEmpty('./src/services/bookApi.ts', /catch \(_error\) \{/g);
fixCatchEmpty('./src/services/gemini.ts', /catch \(_e\) \{/g);
