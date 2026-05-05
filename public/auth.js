// OPTIRAX Auth - fetch interceptor + redirect
(function(){
  var token = localStorage.getItem('optirax_token');
  if(!token && window.location.pathname !== '/login'){
    window.location.href = '/login';
    return;
  }

  // Dodaj Authorization do każdego /api/ requesta
  var _orig = window.fetch;
  window.fetch = function(url, opts){
    opts = opts || {};
    if(typeof url === 'string' && url.indexOf('/api/') === 0){
      opts.headers = opts.headers || {};
      opts.headers['Authorization'] = 'Bearer ' + (localStorage.getItem('optirax_token') || '');
    }
    return _orig(url, opts).then(function(r){
      if(r.status === 401){
        var ref = localStorage.getItem('optirax_refresh');
        if(ref){
          return _orig('/api/auth/refresh', {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({refresh_token: ref})
          }).then(function(rr){
            if(rr.ok) return rr.json().then(function(d){
              localStorage.setItem('optirax_token', d.token);
              localStorage.setItem('optirax_refresh', d.refresh_token);
              opts.headers['Authorization'] = 'Bearer ' + d.token;
              return _orig(url, opts);
            });
            localStorage.clear();
            window.location.href = '/login';
            return r;
          });
        }
        localStorage.clear();
        window.location.href = '/login';
      }
      return r;
    });
  };
})();
