
function onGetCardNonce(event) {

  try { cfte_blink(".pbSubmit:visible"); document.cp_contactformtoemail_pform_1.cp_contactformtoemail_pform_status.value = '1';	 } catch (e) {}

  
  try {
      // Don't submit the form until SqPaymentForm returns with a nonce
    event.preventDefault();
  } catch (e) {}

  if(document.createEvent){
      event = document.createEvent("HTMLEvents");
      event.initEvent("handlecftesquarepayment", true, true);
      event.eventName = "handlecftesquarepayment";
      document.dispatchEvent(event);
  } else {
      event = document.createEventObject();
      event.eventName = "handlecftesquarepayment";
      event.eventType = "handlecftesquarepayment";
      document.fireEvent("on" + event.eventType, event);
  }  
  
}


function onGetCardNonceGPay(event) {

  try { cfte_blink(".pbSubmit:visible"); document.cp_contactformtoemail_pform_1.cp_contactformtoemail_pform_status.value = '1';	 } catch (e) {}

  
  try {
      // Don't submit the form until SqPaymentForm returns with a nonce
    event.preventDefault();
  } catch (e) {}

  if(document.createEvent){
      event = document.createEvent("HTMLEvents");
      event.initEvent("handlecftesquaregooglepaypayment", true, true);
      event.eventName = "handlecftesquaregooglepaypayment";
      document.dispatchEvent(event);
  } else {
      event = document.createEventObject();
      event.eventName = "handlecftesquaregooglepaypayment";
      event.eventType = "handlecftesquaregooglepaypayment";
      document.fireEvent("on" + event.eventType, event);
  }  
}



      const appId = applicationId;
      const locationId = window.locationId;

      async function initializeCard(payments) {
        const card = await payments.card();
        await card.attach('#card-container');

        return card;
      }

      function buildPaymentRequest(payments) {
        // Checkpoint 1
        const defaultShippingOptions = [
          {
            amount: '0.00',
            id: 'shipping-option-1',
            label: 'Free',
          },
        ];

        let lineItems = [
          { amount: (typeof applicationprice !== 'undefined'?applicationprice:'1.00') , label: 'Booking' },
        ];

        let total = calculateTotal(lineItems);

        const paymentRequestDetails = {
          countryCode: 'US',
          currencyCode: applicationcurrency,
          lineItems,
          requestBillingContact: true,
          requestShippingContact: true,
        //  shippingOptions: defaultShippingOptions,
          total,
        };

        const req = payments.paymentRequest(paymentRequestDetails);

        // Checkpoint 2
        req.addEventListener('shippingoptionchanged', (option) => {
          // Add your business logic here.
          // This tells you the shipping options selected by the buyer, and allows you to update
          // totals based on the pricing of each shipping option.
          const newLineItems = updateOrAddLineItems(lineItems, {
            Shipping: option.amount,
          });
          const total = calculateTotal(newLineItems);

          // We want to update the line items it can be referenced later in other eventListener calls.
          lineItems = newLineItems;

          return {
            lineItems,
            total,
          };
        });        

        return req;
      }

      function calculateTotal(lineItems) {
        const amount = lineItems
          .reduce((total, lineItem) => {
            return total + parseFloat(lineItem.amount);
          }, 0.0)
          .toFixed(2);

        return { amount, label: 'Total' };
      }

      // newAmountByLabel will be in the format of { labelName: amount }, e.g. { 'Shipping':'10.00', 'Tax':'3.00' }
      function updateOrAddLineItems(currentLineItems, newAmountsByLabel) {
        // A list  of which newAmounts labels exist in the current line items.
        const updatedLineItem = new Set();

        // set the new amount for the line items that need to be updated.
        const newLineItems = currentLineItems.map((lineItem) => {
          updatedLineItem.add(lineItem.label);
          if (newAmountsByLabel[lineItem.label] !== undefined) {
            return Object.assign({}, lineItem, {
              amount: newAmountsByLabel[lineItem.label],
            });
          }
          return lineItem;
        });

        // for line items that were not updated, add them to the new lineItem list.
        Object.entries(newAmountsByLabel).forEach(([label, amount]) => {
          if (!updatedLineItem.has(label)) {
            newLineItems.push({ label, amount, pending: false });
          }
        });

        return newLineItems;
      }

      function calculateTax(amount, state) {
        let taxPercent = 0; // 0.075

        const taxAmount = parseFloat(amount) * taxPercent;
        // returns a string that truncates to 2 digits, matching the format of '1.25'
        return taxAmount.toFixed(2);
      }
      
      async function initializeGiftCard(payments) {
        const giftCard = await payments.giftCard();
        await giftCard.attach('#gift-card-container');
      
        return giftCard;
      }      

      async function initializeGooglePay(payments) {
        const paymentRequest = buildPaymentRequest(payments);

        const googlePay = await payments.googlePay(paymentRequest);
        await googlePay.attach('#google-pay-button');

        return googlePay;
      }

      async function createPayment(token, verificationToken) {
          cpcfte_square_authorize_cc_card(token, verificationToken);
/**        
        const body = JSON.stringify({
          locationId,
          sourceId: token,
        });

        const paymentResponse = await fetch('/payment', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body,
        });

        if (paymentResponse.ok) {
          return paymentResponse.json();
        }

        const errorBody = await paymentResponse.text();
        throw new Error(errorBody);
*/        
      }

      async function tokenize(paymentMethod, hideerrors) {
        const tokenResult = await paymentMethod.tokenize();
        if (tokenResult.status === 'OK') {
          return tokenResult.token;
        } else {
          try { document.cp_contactformtoemail_pform_1.cp_contactformtoemail_pform_status.value = '0';	 } catch (e) {}
          if (hideerrors) return;
          let errorMessage = `Tokenization failed with status: ${tokenResult.status}`;
          if (tokenResult.errors) {
            errorMessage += ` and errors: ${JSON.stringify(
              tokenResult.errors
            )}`;
          }

          //throw new Error(errorMessage);
        }
      }

      // status is either SUCCESS or FAILURE;
      function displayPaymentResults(status) {
        const statusContainer = document.getElementById(
          'payment-status-container'
        );
        if (status === 'SUCCESS') {
          statusContainer.classList.remove('is-failure');
          statusContainer.classList.add('is-success');
        } else {
          statusContainer.classList.remove('is-success');
          statusContainer.classList.add('is-failure');
        }

        statusContainer.style.visibility = 'visible';
      }



      document.addEventListener('DOMContentLoaded', async function () {
        if (!window.Square) {
          throw new Error('Square.js failed to load properly');
        }

        let payments;
        try {
          payments = window.Square.payments(appId, locationId);
        } catch {
          const statusContainer = document.getElementById(
            'payment-status-container'
          );
          statusContainer.className = 'missing-credentials';
          statusContainer.style.visibility = 'visible';
          return;
        }

        let card;
        try {
          card = await initializeCard(payments);
        } catch (e) {
          console.error('Initializing Card failed', e);
          return;
        }
        
        
        async function verifyBuyer(payments, token) {
          const verificationDetails = {
            amount: applicationprice,
            /* collected from the buyer */
            billingContact: {
              addressLines: ['123 Main Street', 'Apartment 1'],
              familyName: 'Doe',
              givenName: 'John',
              email: 'jondoe@gmail.com',
              country: 'GB',
              phone: '3214563987',
              region: 'LND',
              city: 'London',
            },
            currencyCode: applicationcurrency,
            intent: 'CHARGE',
          };
        
          const verificationResults = await payments.verifyBuyer(
            token,
            verificationDetails
          );
          console.log(verificationResults);
          return verificationResults.token;
        }
        
        
        async function handlePaymentMethodSubmission(event, paymentMethod, hideerrors, shouldVerify) {
          event.preventDefault();

          try {
            // disable the submit button as we await tokenization and make a payment request.
            //cardButton.disabled = true;
            const token = await tokenize(paymentMethod, hideerrors);            
            if (typeof token !== 'undefined') 
            {                

                let verificationToken;
                if (shouldVerify) {                    
                  verificationToken = await verifyBuyer(
                    payments,
                    token
                  );
                }        
                
                console.debug('Verification Token:', verificationToken);
        
                var paymentResults;
                if (shouldVerify) 
                    paymentResults = await createPayment(token, verificationToken);            
                else
                    paymentResults = await createPayment(token, '');            
                displayPaymentResults('SUCCESS');
                console.debug('Payment Success', paymentResults);
                return true;
            }
            else
            {                
                try { document.cp_contactformtoemail_pform_1.cp_contactformtoemail_pform_status.value = '0';	 } catch (e) {}
                if (hideerrors) return false;
                displayPaymentResults('FAILURE');
                return false;            
            }
          } catch (e) {            
           // cardButton.disabled = false;
            try { document.cp_contactformtoemail_pform_1.cp_contactformtoemail_pform_status.value = '0';	 } catch (e) {}
            if (hideerrors) return false;
            displayPaymentResults('FAILURE');
            console.error(e.message);
            return false;
          }
        }        

        //const cardButton = document.getElementById('card-button');
        //cardButton.addEventListener('click', async function (event) {
        //  await handlePaymentMethodSubmission(event, card);
        //});       


        var element =  document.getElementById('gift-card-container');
        let we_have_giftcard =  (typeof(element) != 'undefined' && element != null);
    
        let giftCard;
        if (we_have_giftcard)
        {            
            try {
              giftCard = await initializeGiftCard(payments);
            } catch (e) {
              console.error('Initializing Gift Card failed', e);
            }      
        }
            
        document.addEventListener('handlecftesquarepayment', async function (event) {
          if (we_have_giftcard)
          {
              if (! await handlePaymentMethodSubmission(event, giftCard, true, window.applicationshouldverify))
                  await handlePaymentMethodSubmission(event, card, false, window.applicationshouldverify);
          }
          else
              await handlePaymentMethodSubmission(event, card, false, window.applicationshouldverify);
        });      
      
        return;

        let googlePay;
        try {
          googlePay = await initializeGooglePay(payments);
        } catch (e) {
          console.error('Initializing Google Pay failed', e);
          // There are a number of reason why Google Pay may not be supported
          // (e.g. Browser Support, Device Support, Account). Therefore you should handle
          // initialization failures, while still loading other applicable payment methods.
        }
        
        // Checkpoint 2.
        if (googlePay !== undefined) {
          const googlePayButton = document.getElementById('google-pay-button');
          googlePayButton.addEventListener('click', async function (event) {
            if (cp_contactformtoemail_pform_doValidate_1('squaregooglepay'))  
                await handlePaymentMethodSubmission(event, googlePay, false, window.applicationshouldverify);
          });
          
          document.addEventListener('handlecftesquaregooglepaypayment', async function (event) {
              await handlePaymentMethodSubmission(event, googlePay, false, window.applicationshouldverify);
          });
        }
        
      });