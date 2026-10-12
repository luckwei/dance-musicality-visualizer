export function backendURL(base, path) {
  const url = new URL(base || location.origin);
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname)))) throw new Error('Use an HTTPS backend address, or HTTP on localhost for development.');
  return new URL(path, url.origin).href;
}
export async function backendRequest(base, path, { token = '', key = '', body, signal, method = 'GET', headers = {} } = {}) {
  const requestHeaders = {...headers};
  token=token.trim();key=key.trim();
  if(token)requestHeaders['X-App-Token']=token;
  if(key)requestHeaders.Authorization=`Bearer ${key}`;
  let response;
  try { response = await fetch(backendURL(base,path), {method,body,signal,headers:requestHeaders,credentials:'omit'}); }
  catch(error){if(error.name==='AbortError')throw error;throw new Error('Cannot reach the backend. Check its address and allowed origins.');}
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(typeof data.error==='string'?data.error:`Backend returned ${response.status}.`);
  return data;
}
