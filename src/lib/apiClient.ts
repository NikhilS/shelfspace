import {auth} from '../firebase';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const apiClient = {
  async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const user = auth.currentUser;
    const headers = new Headers(options.headers);

    // Only inject authorization token for absolute routes inside /api/ or relative routes (which hit our backend)
    // To protect against leaking tokens to third party servers like Wikipedia or Google Books APIs
    const isInternalAndRequiresAuth =
      path.startsWith('/api/') || !path.includes('://');

    if (user && isInternalAndRequiresAuth) {
      try {
        const token = await user.getIdToken();
        if (token) {
          headers.set('Authorization', `Bearer ${token}`);
        }
      } catch (authError) {
        console.warn(
          '[apiClient] Failed to retrieve authentication token:',
          authError,
        );
      }
    }

    if (!headers.has('Content-Type') && isInternalAndRequiresAuth) {
      headers.set('Content-Type', 'application/json');
    }

    const response = await fetch(path, {
      ...options,
      headers,
    });

    if (!response.ok) {
      let errText = '';
      try {
        const json = await response.json();
        errText = json.error || json.message || response.statusText;
      } catch {
        try {
          errText = await response.text();
        } catch {
          errText = `HTTP error ${response.status}`;
        }
      }
      throw new ApiError(
        response.status,
        errText || `HTTP error ${response.status}`,
      );
    }

    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      return response.json() as Promise<T>;
    }

    const text = await response.text();
    return text as unknown as T;
  },

  async get<T>(path: string, options: RequestInit = {}): Promise<T> {
    return this.request<T>(path, {
      ...options,
      method: 'GET',
    });
  },

  async post<T>(
    path: string,
    body?: unknown,
    options: RequestInit = {},
  ): Promise<T> {
    return this.request<T>(path, {
      ...options,
      method: 'POST',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  },
};
