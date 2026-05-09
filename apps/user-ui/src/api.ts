import axios from 'axios';

const baseURL = import.meta.env.VITE_API_URL ?? '';
export const api = axios.create({
  baseURL: baseURL ? `${baseURL}/api/v1` : '/api/v1',
  timeout: 10000,
});
