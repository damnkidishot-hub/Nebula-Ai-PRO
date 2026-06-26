const $ = (id) => document.getElementById(id);

async function doLogin() {
  const username = $('username').value.trim();
  const password = $('password').value;
  const err = $('error');
  err.textContent = '';
  if (!username || !password) { err.textContent = 'Enter username and password.'; return; }

  const res = await window.nebula.login({ username, password });
  if (res.ok) {
    Session.set(res.user);
    location.href = 'chat.html';
  } else {
    err.textContent = res.error || 'Login failed.';
  }
}

$('loginBtn').addEventListener('click', doLogin);
$('password').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });

// Already logged in? Skip to chat.
if (Session.get()) location.href = 'chat.html';
