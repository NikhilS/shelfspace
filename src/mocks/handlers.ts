import {http, HttpResponse} from 'msw';

export const handlers = [
  http.get('https://en.wikipedia.org/w/api.php', () => {
    return HttpResponse.json({
      query: {
        search: [{title: 'Test Author'}],
        pages: {
          '123': {
            extract: 'This is a mocked Wikipedia biography.',
          },
        },
      },
    });
  }),
  http.post('/api/batch-enrich', () => {
    return HttpResponse.json({
      results: [
        {
          id: 'book_0',
          temporalMetadata: {isNonHistorical: false, startYear: 1800},
        },
      ],
      failedIds: [],
    });
  }),
  http.get('https://www.googleapis.com/books/v1/volumes', () => {
    return HttpResponse.json({
      items: [
        {
          id: '123',
          volumeInfo: {
            title: 'Mocked Book',
            authors: ['Mocked Author'],
          },
        },
      ],
    });
  }),
];
