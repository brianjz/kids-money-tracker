self.addEventListener('push', event => {
  const data = event.data.json();
  console.log('New push notification received:', data);

  const options = {
    body: data.body,
    icon: '/vite.svg',
    badge: '/vite.svg'
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});