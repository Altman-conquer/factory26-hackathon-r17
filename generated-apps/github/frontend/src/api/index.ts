import axios from 'axios';

const apiClient = axios.create({
  baseURL: '/api',
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' },
});

export function getErrorMessage(error: any, fallback = 'Something went wrong') {
  const data = error?.response?.data;
  if (!data) {
    return fallback;
  }
  if (typeof data.error === 'string') {
    return data.error;
  }
  if (data.errors && typeof data.errors === 'object') {
    return Object.values(data.errors).filter(Boolean).join(' ');
  }
  return fallback;
}

export function getFieldErrors(error: any) {
  return error?.response?.data?.errors || {};
}

export default apiClient;
