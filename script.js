const INITIAL_FETCH_LIMIT = 500;
let [accounts, accountHistory, delegations, dynamicGlobalProperties] = [];
let delegationHistory;
let sbdPrice, steemPrice = 0;

steem.api.setOptions({ url: 'https://api.steemit.com' });
priceHistoryRequest().then(usernameSubmitted);


async function priceHistoryRequest() {
	try {
		// async request of prices here
		let [priceHistorySBD, priceHistorySTEEM] = await Promise.all([
			window.fetch(
			'https://min-api.cryptocompare.com/data/histoday?fsym=SBD*&tsym=USD&limit=14'
			).then(response => response.json()),
			window.fetch(
			'https://min-api.cryptocompare.com/data/histoday?fsym=STEEM&tsym=USD&limit=14'
			).then(response => response.json())
		])

		if (priceHistorySBD.Data.length === 0) return
		priceHistorySBD = priceHistorySBD.Data;
		sbdPrice = _.last(priceHistorySBD).close;
		document.getElementById('sbdPrice').textContent = 'SBD price: $' + sbdPrice;

		if (priceHistorySTEEM.Data.length === 0) return
		priceHistorySTEEM = priceHistorySTEEM.Data;
		steemPrice = _.last(priceHistorySTEEM).close;
		document.getElementById('steemPrice').textContent = 'STEEM price: $' + steemPrice;

	} catch (error) {
		console.log(error.message)
	}
}

async function accountHistoryLoadMore(){
	let fetchLimit = INITIAL_FETCH_LIMIT;
	let nextSequenceIdToLoad = _.last(accountHistory)[0] - 1

	// If initial load has already loaded the complete history, set status and exit
	if (nextSequenceIdToLoad <= 0) return

	// From must be greater than limit when calling getAccountHistoryAsync(name, from, limit)
	if (nextSequenceIdToLoad <= fetchLimit) {
		fetchLimit = nextSequenceIdToLoad - 1
	}

	let accountHistoryMoreData = await steem.api.getAccountHistoryAsync(accounts[0].name, nextSequenceIdToLoad, fetchLimit);
	accountHistory = accountHistory.concat(accountHistoryMoreData.reverse());

	delegationHistory = await buildDelegationHistory(accountHistory, delegations);
	await render(accountHistory, delegationHistory);
}

async function usernameSubmitted(){
	let name = document.getElementById("searchText").value;
	[accounts, accountHistory, delegations, dynamicGlobalProperties] = await Promise.all([
		steem.api.getAccountsAsync([name]),
		steem.api.getAccountHistoryAsync(name, -1, INITIAL_FETCH_LIMIT),
		steem.api.getVestingDelegationsAsync(name, -1, 100),
		steem.api.getDynamicGlobalPropertiesAsync()
	]);

	if (!accounts[0]) return
	if (!accountHistory) return
	if (!delegations) return
	if (!dynamicGlobalProperties) return

	accountHistory = accountHistory.reverse()

	let delegationsObj = {}
	delegations.forEach((item) => {
	  delegationsObj[`${item.delegator}_${item.delegatee}`] = {
		delegator: item.delegator,
		delegatee: item.delegatee,
		vesting_shares: item.vesting_shares,
		vesting_shares_sp: `${Number.parseFloat(vests2Steem(item.vesting_shares, dynamicGlobalProperties)).toFixed(0)} SP`,
		min_delegation_time: item.min_delegation_time
	  }
	})
	delegations = delegationsObj;

	delegationHistory = await buildDelegationHistory(accountHistory, delegations);
	await render(accountHistory, delegationHistory);
}

async function buildDelegationHistory(accountHistory, currentDelegations){
	let delegationHistory = [];

	if (_.isEmpty(accountHistory)) return delegationHistory

	const delegationKeys = Object.keys(currentDelegations)
	const accountHistoryEnd = moment(_.head(accountHistory)[1].timestamp, moment.ISO_8601)
	const accountHistoryStart = moment(_.last(accountHistory)[1].timestamp, moment.ISO_8601)

	_.forOwn(currentDelegations, (delegation) => {
		const { delegator, delegatee, vesting_shares, vesting_shares_sp } = delegation
		delegationHistory[`${delegator}_${delegatee}`] = {
		  delegator,
		  delegatee,
		  vestingShares: vesting_shares,
		  steemPower: vesting_shares_sp,
		  hasMoreData: true,
		  // startDate might be overwritten when we encounter a txType of delegate_vesting_shares
		  startDate: accountHistoryStart,
		  endDate: accountHistoryEnd,
		  transfers: []
		}
	})

	accountHistory.forEach((tx) => {
		const txType = tx[1].op[0]
		const txData = tx[1].op[1]
		if (txType === 'transfer') {
		  const delegationKey = `${txData.to}_${txData.from}`
		  if (delegationKeys.includes(delegationKey)) {
			delegationHistory[delegationKey].transfers.push(tx)
		  }
		} else {
		  // tx is of type TRANSACTION_TYPES.DELEGATE_VESTING_SHARES
		  const delegationKey = `${txData.delegator}_${txData.delegatee}`
		  // Only process current delegations, ignore the rest
		  if (delegationKeys.includes(delegationKey)) {
			// We found when the delegation started, so we overwrite the startDate initialized from accountHistory.
			// This also means we have all data collected for the current delegation.
			delegationHistory[delegationKey].startDate = moment(tx[1].timestamp, moment.ISO_8601)
			// Read all transactions for this delegation, no more data available.
			delegationHistory[delegationKey].hasMoreData = false
			// remove delegation key, because we already collected all transactions from the blockchain
			_.pull(delegationKeys, delegationKey)
		  }
		}
	})

	return delegationHistory
}

async function render(accountHistory, delegationHistory){
	let accountHistoryDays = 0

	if (_.isEmpty(accountHistory)) {
        document.getElementById('date1').textContent = '';
	  } else {
		const accountHistoryEnd = moment(_.head(accountHistory)[1].timestamp, moment.ISO_8601)
		const accountHistoryStart = moment(_.last(accountHistory)[1].timestamp, moment.ISO_8601)
        document.getElementById('date1').textContent = accountHistoryStart.format('MMMM Do YYYY') + ' - ' + accountHistoryEnd.format('MMMM Do YYYY');
        accountHistoryDays = accountHistoryEnd.diff(accountHistoryStart, 'days') + 1
    }
	document.getElementById('date2').textContent = accountHistoryDays + ' days';

	for (let i = myTable.rows.length - 1; i > 0; i--) {
		myTable.deleteRow(i);
	}

	let topAPRs = [0];
	_.forOwn(delegationHistory, (delegation, key) => {
		const delegationROI = roi(delegation);
		if (parseFloat(delegationROI.annualPercentageReturn) > parseFloat(topAPRs[0])){
			topAPRs.splice(0, 0, delegationROI.annualPercentageReturn);
		}
		else if (parseFloat(delegationROI.annualPercentageReturn) > parseFloat(topAPRs[1])){
			topAPRs.splice(1, 0, delegationROI.annualPercentageReturn);
		}
		else if (parseFloat(delegationROI.annualPercentageReturn) > parseFloat(topAPRs[2])){
			topAPRs.splice(2, 0, delegationROI.annualPercentageReturn);
		}
	})

	_.forOwn(delegationHistory, (delegation, key) => {
		let delegationROI = roi(delegation);
		let table = document.getElementById('myTable').getElementsByTagName('tbody')[0];
		let row = table.insertRow(table.rows.length);
		row.insertCell(row.cells.length).innerHTML = "<div class='userpic' style='background-image:url(&apos;https://steemitimages.com/u/" + delegation.delegatee + "/avatar&apos;);'></div>" + delegation.delegatee;
        row.insertCell(row.cells.length).innerHTML = delegation.steemPower;
		row.insertCell(row.cells.length).innerHTML = delegationROI.earnedSBD;
		row.insertCell(row.cells.length).innerHTML = delegationROI.earnedSteem;
		row.insertCell(row.cells.length).innerHTML = delegation.hasMoreData ? '—' : delegation.startDate.format('MMM Do YYYY');
		row.insertCell(row.cells.length).innerHTML = delegation.hasMoreData ? '—' : delegationROI.daysDelegated;
		let innerHtml =
			(delegationROI.annualPercentageReturn == topAPRs[0] ? '<i class="fa fa-trophy fa-2x" style="color:gold"></i> ' :
			delegationROI.annualPercentageReturn == topAPRs[1] ? '<i class="fa fa-trophy fa-2x" style="color:grey"></i> ' :
			delegationROI.annualPercentageReturn == topAPRs[2] ? '<i class="fa fa-trophy fa-2x" style="color:brown"></i> ' : '') +
			delegationROI.annualPercentageReturn + '%';
        row.insertCell(row.cells.length).innerHTML = innerHtml;
        row.insertCell(row.cells.length).innerHTML = delegation.hasMoreData ? "<button type='button' class='btn btn-outline-secondary btn-sm load'>Load more</button>" : 'Full';
	})
}

$(document).on('click', 'button.load', function () {
    var $this = $(this);
    var loadingText = '<i class="fa fa-circle-o-notch fa-spin"></i> loading';
    if ($(this).html() !== loadingText) {
		$this.data('original-text', $(this).html());
		$this.html(loadingText);
		accountHistoryLoadMore();
    }
});

$(function(){
	$('.input-group').keypress(function(e){
		if(e.which == 13) {
			usernameSubmitted();
		}
	})
})

function roi(delegation){
	let transfers = delegation.transfers
	let daysDelegated = delegation.endDate.diff(delegation.startDate, 'days') + 1
	let earnedSteem = 0
	let earnedSBD = 0
	let apr = 0
	transfers.forEach((transfer) => {
		let splits = transfer[1].op[1].amount.split(' ', 2)
		if (splits[1] === 'SBD') {
			earnedSBD += Number(splits[0])
		}
		if (splits[1] === 'STEEM') {
			earnedSteem += Number(splits[0])
		}
	})
	let delegatedSP = unitString2Number(delegation.steemPower)
	apr = (((earnedSBD * sbdPrice / steemPrice) + earnedSteem) / daysDelegated) / delegatedSP * 100 * 365
	return {
		earnedSteem: earnedSteem.toFixed(2),
		earnedSBD: earnedSBD.toFixed(2),
		daysDelegated,
		annualPercentageReturn: apr.toFixed(2)
	}
}

function unitString2Number(stringWithUnit){
	return Number(stringWithUnit.split(' ')[0])
}

// vesting_shares is a string with the unit ' VESTS' appended
// delegateVestingShares only accepts 6 decimal digits, therefore we use toFixed(6) for return
function vests2Steem(vestingShares, dynamicGlobalProperties) {
	const { total_vesting_fund_steem, total_vesting_shares } = dynamicGlobalProperties
	const totalVestingFundSteemNumber = unitString2Number(total_vesting_fund_steem)
	const totalVestingSharesNumber = unitString2Number(total_vesting_shares)
	const vestingSharesNumber = unitString2Number(vestingShares)
  
	return (totalVestingFundSteemNumber * (vestingSharesNumber / totalVestingSharesNumber)).toFixed(6)
}