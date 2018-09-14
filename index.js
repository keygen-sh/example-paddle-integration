// Be sure to add these ENV variables!
const {
  PADDLE_PUBLIC_KEY,
  PADDLE_VENDOR_ID,
  PADDLE_API_KEY,
  PADDLE_PLAN_ID,
  KEYGEN_PRODUCT_TOKEN,
  KEYGEN_ACCOUNT_ID,
  KEYGEN_POLICY_ID,
  PORT = 8080
} = process.env

const { serialize } = require('php-serialize')
const sha1 = require('sha1')
const crypto = require('crypto')
const fetch = require('node-fetch')
const FormData = require('form-data')
const express = require('express')
const bodyParser = require('body-parser')
const morgan = require('morgan')
const app = express()

app.use(bodyParser.json({ type: 'application/vnd.api+json' }))
app.use(bodyParser.json({ type: 'application/json' }))
app.use(bodyParser.urlencoded({ extended: true }))
app.use(morgan('combined'))

app.set('view engine', 'ejs')

// Verify Paddle webhook data using our public key
const verifyPaddleWebhook = data => {
  const signature = data.p_signature
  const keys = Object.keys(data).filter(k => k !== 'p_signature').sort()
  const sorted = {}

  keys.forEach(key => {
    sorted[key] = data[key]
  })

  const serialized = serialize(sorted)
  try {
    const verifier = crypto.createVerify('sha1')
    verifier.write(serialized)
    verifier.end()

    return verifier.verify(PADDLE_PUBLIC_KEY, signature, 'base64')
  } catch (err) {
    return false
  }
}

app.post('/paddle-webhooks', async (req, res) => {
  const { body: paddleEvent } = req

  if (!verifyPaddleWebhook(paddleEvent)) {
    return res.status(400).send('Bad signature or public key') // Webhook was not sent from Paddle
  }

  switch (paddleEvent.alert_name) {
    case 'subscription_created': {
      // 1. Create a license for the new Paddle customer after their subscription
      //    has successfully been created.
      const keygenLicense = await fetch(`https://api.keygen.sh/v1/accounts/${KEYGEN_ACCOUNT_ID}/licenses`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${KEYGEN_PRODUCT_TOKEN}`,
          'Content-Type': 'application/vnd.api+json',
          'Accept': 'application/vnd.api+json'
        },
        body: JSON.stringify({
          data: {
            type: 'licenses',
            attributes: {
              // Since Paddle doesn't allow us to store metadata on their resources,
              // we're going to hash the email and checkout_id together to create a
              // reproducible license key. This will make it easier to lookup later
              // on if the customer ever cancels their subscription.
              key: sha1(`${paddleEvent.email}-${paddleEvent.checkout_id}`).slice(0, 20).split(/(.{4})/).filter(Boolean).join('-'),
              metadata: {
                paddleCustomerEmail: paddleEvent.email,
                paddleSubscriptionId: paddleEvent.subscription_id,
                paddlePlanId: paddleEvent.subscription_plan_id,
                paddleCheckoutId: paddleEvent.checkout_id
              }
            },
            relationships: {
              policy: {
                data: { type: 'policies', id: KEYGEN_POLICY_ID }
              }
            }
          }
        })
      })

      const { data, errors } = await keygenLicense.json()
      if (errors) {
        res.sendStatus(500)

        // If you receive an error here, then you may want to handle the fact the customer
        // may have been charged for a license that they didn't receive e.g. easiest way
        // would be to create it manually, or refund their subscription charge.
        throw new Error(errors.map(e => e.detail).toString())
      }

      // 2. All is good! License was successfully created for the new Paddle customer.
      //    Next up would be for us to email the license key to our customer's email
      //    using `paddleEvent.email` or something similar.

      // Let Paddle know the event was received successfully.
      res.sendStatus(200)
      break
    }
    case 'subscription_updated': {
      // Calculate the license key from the customer's email and the subscription checkout
      // id. See the subscription_created webhook handler above for more info.
      const key = sha1(`${paddleEvent.email}-${paddleEvent.checkout_id}`).slice(0, 20).split(/(.{4})/).filter(Boolean).join('-')

      // Retreive the customer's license whenever their subscription is updated.
      const keygenLicense = await fetch(`https://api.keygen.sh/v1/accounts/${KEYGEN_ACCOUNT_ID}/licenses/${key}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${KEYGEN_PRODUCT_TOKEN}`,
          'Accept': 'application/vnd.api+json'
        }
      })

      const { data: license, errors } = await keygenLicense.json()
      if (errors) {
        return res.sendStatus(200) // License doesn't exist for this customer
      }

      switch (paddleEvent.status) {
        case 'past_due': {
          if (license.attributes.suspended) { // Skip if the license is already suspended
            break
          }

          // Suspend the customer's license whenever their subscription is past due.
          const keygenLicense = await fetch(`https://api.keygen.sh/v1/accounts/${KEYGEN_ACCOUNT_ID}/licenses/${key}/actions/suspend`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${KEYGEN_PRODUCT_TOKEN}`,
              'Accept': 'application/vnd.api+json'
            }
          })

          const { errors } = await keygenLicense.json()
          if (errors) {
            res.sendStatus(500)

            // If you receive an error here, then you may want to handle the fact the customer
            // has a subscription that is past due, but still has a valid license.
            throw new Error(errors.map(e => e.detail).toString())
          }

          break
        }
        case 'active': {
          if (!license.attributes.suspended) { // Skip if the license isn't suspended
            break
          }

          // Reinstate the customer's suspended license whenever their subscription
          // moves out of being past due.
          const keygenLicense = await fetch(`https://api.keygen.sh/v1/accounts/${KEYGEN_ACCOUNT_ID}/licenses/${key}/actions/reinstate`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${KEYGEN_PRODUCT_TOKEN}`,
              'Accept': 'application/vnd.api+json'
            }
          })

          const { errors } = await keygenLicense.json()
          if (errors) {
            res.sendStatus(500)

            // If you receive an error here, then you may want to handle the fact the customer
            // has potentially renewed their subscription, but still has a suspended license.
            throw new Error(errors.map(e => e.detail).toString())
          }

          break
        }
      }

      res.sendStatus(200)
      break
    }
    case 'subscription_cancelled': {
      // Calculate the license key from the customer's email and the subscription checkout
      // id. See the subscription_created webhook handler above for more info.
      const key = sha1(`${paddleEvent.email}-${paddleEvent.checkout_id}`).slice(0, 20).split(/(.{4})/).filter(Boolean).join('-')

      // Revoke the customer's license whenever they cancel their subscription.
      const keygenLicense = await fetch(`https://api.keygen.sh/v1/accounts/${KEYGEN_ACCOUNT_ID}/licenses/${key}/actions/revoke`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${KEYGEN_PRODUCT_TOKEN}`,
          'Accept': 'application/vnd.api+json'
        }
      })

      if (keygenLicense.status !== 204) {
        const { errors } = await keygenLicense.json()
        if (errors) {
          res.sendStatus(500)

          // If you receive an error here, then you may want to handle the fact the customer
          // has potentially canceled their subscription, but still has a valid license.
          throw new Error(errors.map(e => e.detail).toString())
        }
      }

      res.sendStatus(200)
      break
    }
    default: {
      res.sendStatus(200)
    }
  }
})

app.post('/keygen-webhooks', async (req, res) => {
  const { data: { id: keygenEventId } } = req.body

  // Fetch the webhook to validate it and get its most up-to-date state
  const keygenWebhook = await fetch(`https://api.keygen.sh/v1/accounts/${KEYGEN_ACCOUNT_ID}/webhook-events/${keygenEventId}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${KEYGEN_PRODUCT_TOKEN}`,
      'Accept': 'application/vnd.api+json'
    }
  })

  const { data: keygenEvent, errors } = await keygenWebhook.json()
  if (errors) {
    return res.sendStatus(200) // Event does not exist (wasn't sent from Keygen)
  }

  switch (keygenEvent.attributes.event) {
    // 3. Respond to machine creation and deletion events within your Keygen account. Here,
    //    we'll keep our customer's subscription quantity up to date with the number of
    //    machines they have for their license.
    case 'machine.created':
    case 'machine.deleted': {
      const { data: keygenMachine } = JSON.parse(keygenEvent.attributes.payload)

      // 4. Request the customer's license so that we can look up the correct
      //    Paddle subscription.
      const keygenLicense = await fetch(`https://api.keygen.sh/v1/accounts/${KEYGEN_ACCOUNT_ID}/licenses/${keygenMachine.relationships.license.data.id}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${KEYGEN_PRODUCT_TOKEN}`,
          'Accept': 'application/vnd.api+json'
        }
      })

      const { data: license, errors: errs1 } = await keygenLicense.json()
      if (errs1) {
        res.sendStatus(500)

        throw new Error(errs1.map(e => e.detail).toString())
      }

      // 5. Request the customer's machines so that we can update their subscription
      //    to reflect the current machine count.
      const keygenMachines = await fetch(`https://api.keygen.sh/v1/accounts/${KEYGEN_ACCOUNT_ID}/licenses/${license.id}/machines?page[size]=100&page[number]=1`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${KEYGEN_PRODUCT_TOKEN}`,
          'Accept': 'application/vnd.api+json'
        }
      })

      const { data: machines, links, errors: errs2 } = await keygenMachines.json()
      if (errs2) {
        res.sendStatus(500)

        throw new Error(errs2.map(e => e.detail).toString())
      }

      // TODO(ezekg) Handle pagination traversal, where a customer may have more
      //             than 100 machines associated with a single license.
      let machineCount = machines.length

      // 6. Update the customer's Paddle subscription quantity to reflect their
      //    license's current machine count.
      const { paddleSubscriptionId } = license.attributes.metadata
      const formData  = new FormData()
      const params = {
        subscription_id: paddleSubscriptionId,
        quantity: machineCount,
        vendor_id: PADDLE_VENDOR_ID,
        vendor_auth_code: PADDLE_API_KEY
      }

      for (let name in params) {
        formData.append(name, params[name])
      }

      const paddleUpdate = await fetch(`https://vendors.paddle.com/api/2.0/subscription/users/update`, {
        method: 'POST',
        body: formData
      })

      const { success, error } = await paddleUpdate.json()
      if (error) {
        res.sendStatus(500)

        throw new Error(error.message)
      }

      // All is good! Our Paddle customer's subscription quantity has been
      // updated to reflect their up-to-date machine count.
      res.sendStatus(200)
      break
    }
    default: {
      // For events we don't care about, let Keygen know all is good.
      res.sendStatus(200)
    }
  }
})

app.get('/', async (req, res) => {
  res.render('index', {
    PADDLE_VENDOR_ID,
    PADDLE_PLAN_ID
  })
})

process.on('unhandledRejection', err => {
  console.error(`Unhandled rejection: ${err}`, err.stack)
})

const server = app.listen(PORT, 'localhost', () => {
  const { address, port } = server.address()

  console.log(`Listening at http://${address}:${port}`)
})
