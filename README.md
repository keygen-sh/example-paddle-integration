# Example Keygen + Paddle integration
The following web app is written in Node.js and shows how to integrate
[Keygen](https://keygen.sh) and [Paddle](https://paddle.com) together
using webhooks. This example app utilizes Paddle subscriptions to showcase
how to create a concurrent/per-seat licensing system, where the customer
is billed for each active machine that is associated with their license.

The licensing model is implemented by utilizing Paddle's subscription
quantity feature. Each time a new machine is associated with a customer's
license, the subscription's quantity is incremented by 1; likewise, each
time a machine is removed, the subscription's quantity is decremented by 1.

See our [Electron example application](https://github.com/keygen-sh/example-electron-app)
for ideas on how to integrate this type of licensing into your product.

> **This example application is not 100% production-ready**, but it should
> get you 90% of the way there. You may need to add additional logging,
> error handling, as well as listening for additional webhook events.

🚨 Don't want to host your own webhook server? Check out [our Zapier integration](https://keygen.sh/integrate/zapier/).

## Running the app

First up, configure a few environment variables:
```bash
# Your Paddle vendor ID (available at https://vendors.paddle.com/account under "Integrations")
export PADDLE_VENDOR_ID="YOUR_PADDLE_VENDOR_ID"

# Your Paddle API key (available at https://vendors.paddle.com/account under "Integrations")
export PADDLE_API_KEY="YOUR_PADDLE_API_KEY"

# Your Paddle public key (available at https://vendors.paddle.com/account under "Public Key")
export PADDLE_PUBLIC_KEY=$(printf %b \
  '-----BEGIN PUBLIC KEY-----\n' \
  'zdL8BgMFM7p7+FGEGuH1I0KBaMcB/RZZSUu4yTBMu0pJw2EWzr3CrOOiXQI3+6bA\n' \
  # …
  'efK41Ml6OwZB3tchqGmpuAsCEwEAaQ==\n' \
  '-----END PUBLIC KEY-----')

# Paddle plan ID to subscribe customers to
export PADDLE_PLAN_ID="YOUR_PADDLE_PLAN_ID"

# Keygen product token (don't share this!)
export KEYGEN_PRODUCT_TOKEN="YOUR_KEYGEN_PRODUCT_TOKEN"

# Your Keygen account ID
export KEYGEN_ACCOUNT_ID="YOUR_KEYGEN_ACCOUNT_ID"

# The Keygen policy to use when creating licenses for new customers
# after they successfully subscribe to a plan
export KEYGEN_POLICY_ID="YOUR_KEYGEN_POLICY_ID"
```

You can either run each line above within your terminal session before
starting the app, or you can add the above contents to your `~/.bashrc`
file and then run `source ~/.bashrc` after saving the file.

Next, install dependencies with [`yarn`](https://yarnpkg.comg):
```
yarn
```

Then start the app:
```
yarn start
```

## Testing webhooks locally

For local development, create an [`ngrok`](https://ngrok.com) tunnel:
```
ngrok http 8080
```

Next up, add the secure `ngrok` URL to your Paddle and Keygen accounts to
listen for webhooks.

1. **Paddle:** add `https://{YOUR_NGROK_URL}/paddle-webhooks` to https://vendors.paddle.com/account under
   "Alerts", subscribe to `subscription_created`, `subscription_updated`,
   and `subscription_cancelled`
1. **Keygen:** add `https://{YOUR_NGROK_URL}/keygen-webhooks` to https://app.keygen.sh/webhook-endpoints

## Testing the integration

Visit the following url: http://localhost:8080 and fill out the Paddle
checkout form to subscribe.

## Questions?

Reach out at [support@keygen.sh](mailto:support@keygen.sh) if you have any
questions or concerns!
