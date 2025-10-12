self.addEventListener('push', event => {
  const data = event.data.json();
  console.log('New push notification received:', data);

  const options = {
    body: data.body,
    icon: '/money-tracker.svg',
    badge: '/money-tracker.svg'
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});