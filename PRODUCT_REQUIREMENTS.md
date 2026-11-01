# UPI Expense Tracker App – Product Requirements

> Part 1 of the UPI Expense Tracker App overview. See [TECHNICAL_IMPLEMENTATION.md](TECHNICAL_IMPLEMENTATION.md) for Part 2.

## 1. Problem Statement

We make many payments through UPI every day. As the number of transactions increases, it becomes difficult to remember where our money went and what we spent it on.

Our app aims to solve this problem by providing a clear overview of the user's spending habits.

**The main goal is to help users understand where their money goes, how they spend it, and which categories account for most of their expenses.**

## 2. Core Features

### 2.1 Home Page

The home page should provide a quick overview of the user's spending.

- **Spending Overview:** Show spending for today, this week, and this month.
- **Category Breakdown:** Display expenses by category, such as Food, Travel, Shopping, and Bills.
- **Spending Insights:** Calculate average spending using historical transaction records and highlight spending that is higher than usual.
- **Transaction Locations:** Show the location associated with a transaction when available.

Users should be able to understand their spending at a glance without navigating through multiple pages.

### 2.2 Transactions Page

Users should be able to view and manage all their transactions.

- Display the amount, date, merchant, and category for each transaction.
- Allow users to filter transactions by date or date range.
- Provide search functionality to find specific transactions.
- Show the transaction location when available.
- Allow users to manually add, edit, and delete transactions.



### 2.3 Categories

Every transaction should have a category.

- **Automatic Categorization:** Identify categories based on merchant details and transaction information. For example, Swiggy transactions should be categorized under Food.
- **Manual Categorization:** Allow users to assign or update a category when it is missing or incorrect.
- **Remember User Preferences:** Save the user's category choice for a merchant or UPI ID.
- **Automatic Updates:** Apply saved category mappings to existing and future transactions from the same merchant or UPI ID.

This will reduce manual work and make expense tracking easier over time.

### 2.4 Profile

The profile page should contain basic user information and app settings, including location permissions and other preferences.

**Theme Settings:** Allow users to switch between light and dark themes. This option will be available under Profile Settings.

### 2.5 Lending

Money lent to someone has left the account but has not been spent, and the app should be able to say how much of it is still out there.

- **A lend is a transaction.** Any payment categorised as Lend becomes a lend. There is no separate thing to create and no separate place it lives.
- **A payee can be marked as Lend.** Setting the category against a UPI ID or a name makes every payment to that person a lend, past and future, the same way category preferences already work.
- **Cash lends can be added by hand.** A UPI lend is already a payment in the app; only cash has to be typed in.
- **Repayments by UPI are matched automatically.** When money comes back from the same person it is attached to their open lend and the amount left goes down. Part of the amount is the normal case, not an exception.
- **Repayments can also be recorded by hand**, for cash handed back in person.
- **A lend closes when the whole amount has come back.** Until then the app shows what is still to be received.
- **A Lending page** lists who owes what, with the total left to get back, and is reached from the same title menu as Home and Transactions.

Lent money never counts as spending, and neither does it coming back.

## 3. App Structure

The app will have five main sections:

1. **Home:** Spending overview, category breakdown, and spending insights.
2. **Transactions:** Complete transaction history with search, filters, and options to add, edit, and delete transactions.
3. **Lending:** Money lent out, what has come back, and what is still to be received.
4. **Categories:** Manage spending categories and merchant-to-category mappings.
5. **Profile:** User information, app settings, permissions, and theme preferences.

## 4. Expected Outcome

The app should help users understand their spending without manually tracking every transaction.

The home page should show daily, weekly, and monthly spending, category-wise expenses, and highlights when spending is higher than usual.

**The key value of the app is spending clarity: helping users understand where their money goes with minimal effort.**