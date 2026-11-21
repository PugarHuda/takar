// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TakarSettle4} from "../src/TakarSettle4.sol";
import {IERC20} from "../src/TakarSettle.sol";
import {MockUSDC3} from "./TakarSettle3.t.sol";

contract TakarSettle4Test is Test {
    MockUSDC3 usdc;
    TakarSettle4 s;
    address r1 = address(0xA1);
    address r2 = address(0xA2);
    address r3 = address(0xA3);
    address payer = address(0xB0B);
    address payee = address(0xCAFE);

    function setUp() public {
        usdc = new MockUSDC3();
        address[] memory rs = new address[](3);
        (rs[0], rs[1], rs[2]) = (r1, r2, r3);
        s = new TakarSettle4(IERC20(address(usdc)), rs, 1, 10 minutes, 1e6); // one resolver suffices, until it is contested
        usdc.mint(payer, 100e6); usdc.mint(payee, 100e6);
        vm.prank(payer); usdc.approve(address(s), type(uint256).max);
        vm.prank(payee); usdc.approve(address(s), type(uint256).max);
    }

    function _sig(string memory a, string memory b) internal pure returns (bytes32[] memory sig) {
        sig = new bytes32[](2); sig[0] = keccak256(bytes(a)); sig[1] = keccak256(bytes(b));
    }
    function _h(bool met, bytes32[] memory sig) internal pure returns (bytes32) { return keccak256(abi.encode(met, sig)); }

    function test_bothPartiesDisputedMeansFullPanel() public {
        vm.prank(payer);
        uint256 id = s.open(payee, 10e6, uint64(block.timestamp + 1 hours), TakarSettle4.Kind.Event, "pay unless sanctioned");
        vm.warp(block.timestamp + 1 hours);
        vm.prank(r1); s.propose(id, true, _sig("a", "b"), "");
        assertGt(s.deal(id).finalizesAt, 0, "threshold 1: window opens at once");
        vm.prank(payer); s.dispute(id);
        vm.prank(r1); s.propose(id, false, _sig("c", "d"), "");
        vm.prank(payee); s.dispute(id);
        assertEq(s.required(id), 3, "both disputed: the whole panel");
        bytes32[] memory sig = _sig("e", "f");
        vm.prank(r1); s.propose(id, true, sig, "");
        assertEq(s.deal(id).finalizesAt, 0, "one resolver is no longer enough");
        vm.prank(r2); s.second(id, _h(true, sig));
        assertEq(s.deal(id).finalizesAt, 0, "two of three is not enough either");
        vm.prank(r3); s.second(id, _h(true, sig));
        assertGt(s.deal(id).finalizesAt, 0);
        vm.warp(block.timestamp + 10 minutes);
        s.finalize(id);
        assertEq(usdc.balanceOf(payee), 100e6 + 10e6 + 1e6, "paid; the payee disputed the refund and was right (bond back), the payer disputed the payment and was wrong (its bond to the payee)");
    }

    function test_oneDisputeKeepsThreshold() public {
        vm.prank(payer);
        uint256 id = s.open(payee, 10e6, uint64(block.timestamp + 1 hours), TakarSettle4.Kind.Event, "x");
        vm.warp(block.timestamp + 1 hours);
        vm.prank(r1); s.propose(id, true, _sig("a", "b"), "");
        vm.prank(payer); s.dispute(id);
        assertEq(s.required(id), 1);
    }
}
