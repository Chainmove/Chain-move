export interface NormalizedPaystackTransaction {
  reference: string
  amount: number // In NGN (not kobo)
  currency: string
  status: "success" | "failed" | "abandoned" | "reversed"
  customerEmail?: string
  customerName?: string
  dedicatedAccountNumber?: string
  channel?: string
  paidAt?: string
  createdAt: string
  metadata?: Record<string, unknown>
}

export interface PaystackCustomer {
  id: number
  email: string
  customer_code: string
  first_name?: string
  last_name?: string
  phone?: string
}

export interface PaystackDedicatedAccount {
  account_number: string
  account_name: string
  bank_name: string
  customer?: PaystackCustomer
}

export interface PaystackTransactionRecord {
  id: number
  domain: string
  status: "success" | "failed" | "abandoned" | "reversed"
  reference: string
  amount: number // In kobo (divide by 100 for NGN)
  gateway_response: string
  paid_at?: string
  created_at: string
  channel: string
  currency: string
  ip_address?: string
  customer?: PaystackCustomer
  authorization?: {
    authorization_code: string
    bin: string
    last4: string
    exp_month: string
    exp_year: string
    card_type: string
    bank: string
  }
  dedicated_account?: PaystackDedicatedAccount
}

export interface PaystackPaginatedResponse<T> {
  status: boolean
  message: string
  data: T[]
  meta: {
    total: number
    skipped: number
    perPage: number
    page: number
    pageCount: number
  }
}

export interface FetchTransactionsQuery {
  from?: string
  to?: string
  page?: number
  perPage?: number
  status?: string
}

export interface AcceptNormalizedTxQuery {
  transactions: NormalizedPaystackTransaction[]
  source?: string
  receivedAt?: string
}

export interface IPaystackAdapter {
  fetchTransactions(query: FetchTransactionsQuery): Promise<PaystackPaginatedResponse<PaystackTransactionRecord>>
  verifyTransaction(reference: string): Promise<PaystackTransactionRecord | null>
  acceptNormalizedTransactions(query: AcceptNormalizedTxQuery): Promise<{ accepted: number; rejected: number; errors: string[] }>
}
