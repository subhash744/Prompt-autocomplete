// api/webhook.js — Dodo Payments webhook handler for Vercel
// Deploy this to your Vercel project at promptautocomplete.vercel.app

import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client with service role key (server-side only)
const supabaseUrl = process.env.SUPABASE_URL || 'https://bscjhmxdwantvgqomykx.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Webhook secret from Dodo dashboard
const WEBHOOK_SECRET = process.env.DODO_WEBHOOK_SECRET || 'whsec_1bEmlkE/Ta4zI4moRzMnXP5hD9+YNovi';

export default async function handler(req, res) {
  // Only accept POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Verify webhook signature (if Dodo provides signing)
    const signature = req.headers['x-dodo-signature'];
    
    // Log the event for debugging
    console.log('Dodo webhook received:', req.body);

    const event = req.body;

    if (!event || !event.event_type) {
      return res.status(400).json({ error: 'Invalid webhook payload' });
    }

    // Handle different event types
    switch (event.event_type) {
      case 'payment.success':
      case 'subscription.created':
      case 'subscription.active':
        await handlePaymentSuccess(event.data);
        break;

      case 'subscription.expired':
      case 'subscription.canceled':
      case 'payment.failed':
        await handleSubscriptionExpired(event.data);
        break;

      default:
        console.log('Unhandled event type:', event.event_type);
    }

    // Always return 200 to acknowledge receipt
    return res.status(200).json({ received: true });

  } catch (error) {
    console.error('Webhook error:', error);
    // Still return 200 to prevent Dodo from retrying
    return res.status(200).json({ received: true, error: error.message });
  }
}

async function handlePaymentSuccess(data) {
  const { 
    customer_id, 
    customer_email,
    payment_id,
    product_id,
    status,
    amount,
    currency = 'USD'
  } = data;

  if (!customer_id) {
    console.error('No customer_id in payment data');
    return;
  }

  // Calculate expiration (1 year from now for one-time purchase)
  const expiresAt = new Date();
  expiresAt.setFullYear(expiresAt.getFullYear() + 1);

  // Update user's premium status in Supabase
  const { error: userError } = await supabase
    .from('users')
    .update({
      is_premium: true,
      subscription_status: 'active',
      subscription_expires_at: expiresAt.toISOString(),
      dodo_customer_id: customer_id,
      updated_at: new Date().toISOString()
    })
    .eq('id', customer_id);

  if (userError) {
    console.error('Failed to update user:', userError);
    throw userError;
  }

  // Record the subscription/payment
  const { error: subError } = await supabase
    .from('subscriptions')
    .insert({
      user_id: customer_id,
      dodo_payment_id: payment_id,
      dodo_product_id: product_id,
      status: status || 'completed',
      amount: amount,
      currency: currency,
      expires_at: expiresAt.toISOString()
    });

  if (subError) {
    console.error('Failed to record subscription:', subError);
    // Don't throw here, the user was already updated
  }

  console.log(`✓ User ${customer_id} upgraded to premium`);
}

async function handleSubscriptionExpired(data) {
  const { customer_id } = data;

  if (!customer_id) return;

  // Update user's premium status
  const { error } = await supabase
    .from('users')
    .update({
      is_premium: false,
      subscription_status: 'expired',
      updated_at: new Date().toISOString()
    })
    .eq('id', customer_id);

  if (error) {
    console.error('Failed to update expired user:', error);
    throw error;
  }

  console.log(`✓ User ${customer_id} premium expired`);
}
