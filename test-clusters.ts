import * as dotenv from 'dotenv';
dotenv.config();
import {generateClusterNames} from './src/services/gemini.ts';

const clusters = [
  {id: 0, books: [{title: 'Dune'}, {title: 'Foundation'}]},
  {id: 1, books: [{title: 'The Hobbit'}, {title: 'Fellowship'}]},
];

generateClusterNames(clusters).then(console.log).catch(console.error);
