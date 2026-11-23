// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TakarSettle5} from "../src/TakarSettle5.sol";
import {IERC20} from "../src/TakarSettle.sol";
import {MockUSDC3} from "./TakarSettle3.t.sol";

contract TakarSettle5Test is Test {
    MockUSDC3 usdc;
    TakarSettle5 s;
    address r1 = address(0xA1);
    address r2 = address(0xA2);
    address r3 = address(0xA3);
    address payer = address(0xB0B);
    address payee = address(0xCAFE);

    function setUp() public {
        usdc = new MockUSDC3();
        address[] memory rs = new address[](3);
        (rs[0], rs[1], rs[2]) = (r1, r2, r3);
        s = new TakarSettle5(IERC20(address(usdc)), rs, 2, 10 minutes, 1e6);
        usdc.mint(payer, 100e6); usdc.mint(payee, 100e6);
        vm.prank(payer); usdc.approve(address(s), type(uint256).max);
        vm.prank(payee); usdc.approve(address(s), type(uint256).max);
    }

    function _sig(string memory a, string memory b) internal pure returns (bytes32[] memory sig) {
        sig = new bytes32[](2); sig[0] = keccak256(bytes(a)); sig[1] = keccak256(bytes(b));
    }
    function _h(uint96 p, bytes32[] memory sig) internal pure returns (bytes32) { return keccak256(abi.encode(p, sig)); }

    function _open() internal returns (uint256 id) {
        vm.prank(payer);
        id = s.open(payee, 10e6, uint64(block.timestamp + 1 hours), TakarSettle5.Kind.Event, "pay for accepted units");
        vm.warp(block.timestamp + 1 hours);
    }

    /// Quantity dispute: the supplier claims full delivery, the buyer accepted 960 of 1000.
    function test_splitAfterBothDisputes() public {
        uint256 id = _open();
        bytes32[] memory a = _sig("full", "claim");
        vm.prank(r1); s.propose(id, 10e6, a, "pay in full");
        vm.prank(r2); s.second(id, _h(10e6, a));
        vm.prank(payer); s.dispute(id); // buyer: only 960 accepted
        bytes32[] memory b = _sig("refund", "all");
        vm.prank(r1); s.propose(id, 0, b, "refund");
        vm.prank(payee); s.dispute(id); // supplier: goods were delivered
        assertEq(s.required(id), 3, "both disputed: whole panel");
        bytes32[] memory c = _sig("grn", "count");
        vm.prank(r1); s.propose(id, 9.6e6, c, "pay for 960 accepted units");
        vm.prank(r2); s.second(id, _h(9.6e6, c));
        assertEq(s.deal(id).finalizesAt, 0, "two of three is not enough once contested");
        vm.prank(r3); s.second(id, _h(9.6e6, c));
        vm.warp(block.timestamp + 10 minutes);
        s.finalize(id);
        // Neither party's disputed payout stood, so both bonds return.
        assertEq(usdc.balanceOf(payee), 100e6 + 9.6e6, "supplier paid for accepted units, bond back");
        assertEq(usdc.balanceOf(payer), 100e6 - 10e6 + 0.4e6, "buyer refunded the rest, bond back");
        assertEq(usdc.balanceOf(address(s)), 0);
    }

    function test_bondLostWhenDisputedPayoutStands() public {
        uint256 id = _open();
        bytes32[] memory a = _sig("a", "b");
        vm.prank(r1); s.propose(id, 9.6e6, a, "");
        vm.prank(payee); s.dispute(id); // supplier wants the full amount
        bytes32[] memory b = _sig("c", "d");
        vm.prank(r1); s.propose(id, 9.6e6, b, "same payout, fresh evidence");
        vm.prank(r2); s.second(id, _h(9.6e6, b));
        assertEq(s.deal(id).finalizesAt, 0, "one dispute already needs the whole panel: two seats of one operator cannot settle it");
        vm.prank(r3); s.second(id, _h(9.6e6, b));
        vm.warp(block.timestamp + 10 minutes);
        s.finalize(id);
        assertEq(usdc.balanceOf(payer), 100e6 - 10e6 + 0.4e6 + 1e6, "supplier disputed 9.6 and 9.6 stood: its bond goes to the buyer");
        assertEq(usdc.balanceOf(payee), 100e6 - 1e6 + 9.6e6);
    }

    function test_payoutCannotExceedAmount() public {
        uint256 id = _open();
        vm.prank(r1);
        vm.expectRevert(bytes("payout over amount"));
        s.propose(id, 10e6 + 1, _sig("a", "b"), "");
    }

    function test_fullRefundAndFullPay() public {
        uint256 id = _open();
        bytes32[] memory a = _sig("a", "b");
        vm.prank(r1); s.propose(id, 0, a, "");
        vm.prank(r2); s.second(id, _h(0, a));
        vm.warp(block.timestamp + 10 minutes);
        s.finalize(id);
        assertEq(usdc.balanceOf(payer), 100e6);
    }
}
